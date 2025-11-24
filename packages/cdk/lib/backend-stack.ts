import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { ApplicationLoadBalancedFargateService } from "aws-cdk-lib/aws-ecs-patterns";
import { ContainerImage, Secret as EcsSecret } from "aws-cdk-lib/aws-ecs";
import {
  ApplicationProtocol,
  ListenerAction,
  ListenerCondition,
  UnauthenticatedAction,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { DockerImageAsset, Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as path from "path";
import { AuthenticateCognitoAction } from "aws-cdk-lib/aws-elasticloadbalancingv2-actions";

import { Role, ServicePrincipal, PolicyStatement } from "aws-cdk-lib/aws-iam";
import * as dotenv from "dotenv";
import { readFileSync } from "fs";
import { NagSuppressions } from "cdk-nag";

export interface StackProps extends cdk.StackProps {
  domainName: string;
  apiName: string;
  accessLogging?: boolean;
}

export class SonicBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    const fqdn = `${props.apiName}.${props.domainName}`;

    const hostedZoneId = route53.HostedZone.fromLookup(this, "hosted-zone", {
      domainName: props.domainName,
    });

    const container = new DockerImageAsset(this, "sonic-server-image", {
      directory: path.join(__dirname, "..", "docker"),
      platform: Platform.LINUX_AMD64,
    });

    const sonicServerRole = new Role(this, "sonicServerRole", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    sonicServerRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:InvokeModelWithBidirectionalStream",
        ],
        resources: [
          "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-sonic-v1:0",
        ],
      })
    );

    // Add Parameter Store permissions for MCP tool configuration
    sonicServerRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:PutParameter",
          "ssm:DeleteParameter",
          "ssm:DescribeParameters",
        ],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/${props.apiName}/mcp/*`,
        ],
      })
    );

    // Add KMS permissions for SecureString decryption/encryption
    sonicServerRole.addToPolicy(
      new PolicyStatement({
        actions: ["kms:Decrypt", "kms:Encrypt", "kms:DescribeKey"],
        resources: ["*"],
        conditions: {
          StringEquals: {
            "kms:ViaService": `ssm.${this.region}.amazonaws.com`,
          },
        },
      })
    );

    NagSuppressions.addResourceSuppressionsByPath(
      this,
      "/SonicBackendStack/sonicServerRole/DefaultPolicy/Resource",
      [
        {
          id: "AwsSolutions-IAM5",
          reason: "No wildcard",
        },
      ]
    );

    // Create parameters in Parameter Store with environment variables from .env file
    const envVars = dotenv.parse(readFileSync("../api/.env").toString("utf8"));
    const parameters: Record<string, ssm.StringParameter> = {};

    // Create SSM parameters for each environment variable
    Object.entries(envVars).forEach(([key, value]) => {
      parameters[key] = new ssm.StringParameter(this, `AppEnvVar-${key}`, {
        parameterName: `/${props.apiName}/env/${key}`,
        stringValue: value,
        description: `Environment variable ${key} for ${props.apiName}`,
        tier: ssm.ParameterTier.STANDARD,
      });
    });

    parameters["API_NAME"] = new ssm.StringParameter(
      this,
      `AppEnvVar-API_NAME`,
      {
        parameterName: `/${props.apiName}/env/API_NAME`,
        stringValue: props.apiName,
        description: `Environment variable API_NAME for ${props.apiName}`,
        tier: ssm.ParameterTier.STANDARD,
      }
    );

    // Grant the task role permission to read the parameters
    sonicServerRole.addToPolicy(
      new PolicyStatement({
        actions: ["ssm:GetParameters", "ssm:GetParameter"],
        resources: Object.values(parameters).map((param) => param.parameterArn),
      })
    );

    const aLBService = new ApplicationLoadBalancedFargateService(this, "tg", {
      assignPublicIp: false,
      desiredCount: 1,
      domainName: fqdn,
      domainZone: hostedZoneId,
      protocol: ApplicationProtocol.HTTPS,
      redirectHTTP: false,
      taskImageOptions: {
        image: ContainerImage.fromDockerImageAsset(container),
        containerPort: 3000,
        taskRole: sonicServerRole,
        secrets: Object.entries(parameters).reduce(
          (acc, [key, param]) => {
            acc[key] = EcsSecret.fromSsmParameter(param);
            return acc;
          },
          {} as Record<string, EcsSecret>
        ),
      },
      cpu: 1024,
      memoryLimitMiB: 2048,
      enableExecuteCommand: true,
    });

    NagSuppressions.addResourceSuppressionsByPath(
      this,
      "/SonicBackendStack/tg/TaskDef/ExecutionRole/DefaultPolicy/Resource",
      [
        {
          id: "AwsSolutions-IAM5",
          reason: "This is the default role",
        },
      ]
    );

    //This can be further restricted to allow egress from LB -> a security group that controls access
    //For now we're allowing outbound 443 to anywhere so that the LB can reach Cognito to verify tokens
    aLBService.loadBalancer.connections.allowToAnyIpv4(
      ec2.Port.tcp(443),
      "Allow ALB to reach Cognito to verify tokens"
    );

    aLBService.loadBalancer.connections.allowFromAnyIpv4(
      ec2.Port.tcp(443),
      "Allow access to the load balancer"
    );

    NagSuppressions.addResourceSuppressionsByPath(
      this,
      "/SonicBackendStack/tg/LB/SecurityGroup/Resource",
      [
        {
          id: "AwsSolutions-EC23",
          reason:
            "This is a public-facing load balancer that needs to be accessible on HTTPS port 443",
        },
      ]
    );

    NagSuppressions.addResourceSuppressions(aLBService.loadBalancer, [
      {
        id: "AwsSolutions-ELB2",
        reason: "This is a load balancer for a demo.",
      },
    ]);

    NagSuppressions.addResourceSuppressions(aLBService.cluster.vpc, [
      { id: "AwsSolutions-VPC7", reason: "This is a demo VPC" },
    ]);

    aLBService.targetGroup.configureHealthCheck({
      path: "/health",
      healthyHttpCodes: "200",
    });

    // Enable Container Insights for the cluster
    const cfnCluster = aLBService.cluster.node
      .defaultChild as cdk.aws_ecs.CfnCluster;
    cfnCluster.addPropertyOverride("ClusterSettings", [
      {
        Name: "containerInsights",
        Value: "enabled",
      },
    ]);

    NagSuppressions.addResourceSuppressions(aLBService.cluster, [
      {
        id: "AwsSolutions-ECS4",
        reason: "This is a demo cluster.",
      },
    ]);

    //Cognito resources
    //TODO: Allow users to provide their own user pool
    const userPool = new cognito.UserPool(this, "SonicUserPool", {
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      passwordPolicy: {
        minLength: 8,
        requireDigits: true,
        requireLowercase: true,
        requireSymbols: true,
        requireUppercase: true,
      },
    });

    NagSuppressions.addResourceSuppressions(userPool, [
      {
        id: "AwsSolutions-COG2",
        reason: "This is a demo application.",
      },
      {
        id: "AwsSolutions-COG3",
        reason: "This is a demo application.",
      },
    ]);

    const userPoolClient = new cognito.UserPoolClient(this, "Client", {
      userPool,
      // Required minimal configuration for use with an ELB
      generateSecret: true,
      authFlows: {
        userPassword: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [cognito.OAuthScope.EMAIL],
        callbackUrls: [`https://${fqdn}/oauth2/idpresponse`],
      },
    });

    const cfnClient = userPoolClient.node
      .defaultChild as cognito.CfnUserPoolClient;
    cfnClient.addPropertyOverride("RefreshTokenValidity", 7);
    cfnClient.addPropertyOverride("SupportedIdentityProviders", ["COGNITO"]);

    const userPoolDomain = new cognito.UserPoolDomain(this, "Domain", {
      userPool,
      cognitoDomain: {
        domainPrefix: `${props.apiName}-users`,
      },
    });

    //Cognito resources
    //All requests to be authenticated by Cognito
    aLBService.listener.addAction("manifest-json", {
      action: ListenerAction.forward([aLBService.targetGroup]),
      conditions: [
        ListenerCondition.pathPatterns([
          "/manifest.json",
          "/icons/*",
          "/oauth2/*",
        ]),
      ],
      priority: 1,
    });
    aLBService.listener.addAction("cognito-rule", {
      action: new AuthenticateCognitoAction({
        userPool,
        userPoolClient,
        userPoolDomain,
        sessionTimeout: cdk.Duration.days(7),
        next: ListenerAction.forward([aLBService.targetGroup]),
        onUnauthenticatedRequest: UnauthenticatedAction.AUTHENTICATE,
      }),
    });

    new cdk.CfnOutput(this, "UserPool", {
      description: "Amazon Cognito UserPool User management console",
      value: `https://console.aws.amazon.com/cognito/v2/idp/user-pools/${userPool.userPoolId}/user-management/users`,
    });

    new cdk.CfnOutput(this, "AppURL", {
      description: "Application URL",
      value: `https://${fqdn}`,
    });
  }
}
