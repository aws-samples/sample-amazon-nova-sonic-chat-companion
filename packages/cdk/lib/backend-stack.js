"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SonicBackendStack = void 0;
const cdk = require("aws-cdk-lib");
const aws_ecs_patterns_1 = require("aws-cdk-lib/aws-ecs-patterns");
const aws_ecs_1 = require("aws-cdk-lib/aws-ecs");
const aws_elasticloadbalancingv2_1 = require("aws-cdk-lib/aws-elasticloadbalancingv2");
const aws_ecr_assets_1 = require("aws-cdk-lib/aws-ecr-assets");
const cognito = require("aws-cdk-lib/aws-cognito");
const route53 = require("aws-cdk-lib/aws-route53");
const ec2 = require("aws-cdk-lib/aws-ec2");
const ssm = require("aws-cdk-lib/aws-ssm");
const path = require("path");
const aws_elasticloadbalancingv2_actions_1 = require("aws-cdk-lib/aws-elasticloadbalancingv2-actions");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const dotenv = require("dotenv");
const fs_1 = require("fs");
const cdk_nag_1 = require("cdk-nag");
class SonicBackendStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const fqdn = `${props.apiName}.${props.domainName}`;
        const hostedZoneId = route53.HostedZone.fromLookup(this, "hosted-zone", {
            domainName: props.domainName,
        });
        const container = new aws_ecr_assets_1.DockerImageAsset(this, "sonic-server-image", {
            directory: path.join(__dirname, "..", "docker"),
            platform: aws_ecr_assets_1.Platform.LINUX_AMD64,
        });
        const sonicServerRole = new aws_iam_1.Role(this, "sonicServerRole", {
            assumedBy: new aws_iam_1.ServicePrincipal("ecs-tasks.amazonaws.com"),
        });
        sonicServerRole.addToPolicy(new cdk.aws_iam.PolicyStatement({
            actions: [
                "bedrock:InvokeModel",
                "bedrock:InvokeModelWithResponseStream",
                "bedrock:InvokeModelWithBidirectionalStream",
            ],
            resources: [
                "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-sonic-v1:0",
            ],
        }));
        // Add Parameter Store permissions for MCP tool configuration
        sonicServerRole.addToPolicy(new aws_iam_1.PolicyStatement({
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
        }));
        // Add KMS permissions for SecureString decryption/encryption
        sonicServerRole.addToPolicy(new aws_iam_1.PolicyStatement({
            actions: ["kms:Decrypt", "kms:Encrypt", "kms:DescribeKey"],
            resources: ["*"],
            conditions: {
                StringEquals: {
                    "kms:ViaService": `ssm.${this.region}.amazonaws.com`,
                },
            },
        }));
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, "/SonicBackendStack/sonicServerRole/DefaultPolicy/Resource", [
            {
                id: "AwsSolutions-IAM5",
                reason: "No wildcard",
            },
        ]);
        // Create parameters in Parameter Store with environment variables from .env file
        const envVars = dotenv.parse((0, fs_1.readFileSync)("../api/.env").toString("utf8"));
        const parameters = {};
        // Create SSM parameters for each environment variable
        Object.entries(envVars).forEach(([key, value]) => {
            parameters[key] = new ssm.StringParameter(this, `AppEnvVar-${key}`, {
                parameterName: `/${props.apiName}/env/${key}`,
                stringValue: value,
                description: `Environment variable ${key} for ${props.apiName}`,
                tier: ssm.ParameterTier.STANDARD,
            });
        });
        // Grant the task role permission to read the parameters
        sonicServerRole.addToPolicy(new aws_iam_1.PolicyStatement({
            actions: ["ssm:GetParameters", "ssm:GetParameter"],
            resources: Object.values(parameters).map((param) => param.parameterArn),
        }));
        const aLBService = new aws_ecs_patterns_1.ApplicationLoadBalancedFargateService(this, "tg", {
            assignPublicIp: false,
            desiredCount: 1,
            domainName: fqdn,
            domainZone: hostedZoneId,
            protocol: aws_elasticloadbalancingv2_1.ApplicationProtocol.HTTPS,
            redirectHTTP: false,
            taskImageOptions: {
                image: aws_ecs_1.ContainerImage.fromDockerImageAsset(container),
                containerPort: 3000,
                taskRole: sonicServerRole,
                secrets: Object.entries(parameters).reduce((acc, [key, param]) => {
                    acc[key] = aws_ecs_1.Secret.fromSsmParameter(param);
                    return acc;
                }, {}),
            },
            cpu: 1024,
            memoryLimitMiB: 2048,
            enableExecuteCommand: true,
        });
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, "/SonicBackendStack/tg/TaskDef/ExecutionRole/DefaultPolicy/Resource", [
            {
                id: "AwsSolutions-IAM5",
                reason: "This is the default role",
            },
        ]);
        //This can be further restricted to allow egress from LB -> a security group that controls access
        //For now we're allowing outbound 443 to anywhere so that the LB can reach Cognito to verify tokens
        aLBService.loadBalancer.connections.allowToAnyIpv4(ec2.Port.tcp(443), "Allow ALB to reach Cognito to verify tokens");
        aLBService.loadBalancer.connections.allowFromAnyIpv4(ec2.Port.tcp(443), "Allow access to the load balancer");
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, "/SonicBackendStack/tg/LB/SecurityGroup/Resource", [
            {
                id: "AwsSolutions-EC23",
                reason: "This is a public-facing load balancer that needs to be accessible on HTTPS port 443",
            },
        ]);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(aLBService.loadBalancer, [
            {
                id: "AwsSolutions-ELB2",
                reason: "This is a load balancer for a demo.",
            },
        ]);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(aLBService.cluster.vpc, [
            { id: "AwsSolutions-VPC7", reason: "This is a demo VPC" },
        ]);
        aLBService.targetGroup.configureHealthCheck({
            path: "/health",
            healthyHttpCodes: "200",
        });
        // Enable Container Insights for the cluster
        const cfnCluster = aLBService.cluster.node
            .defaultChild;
        cfnCluster.addPropertyOverride("ClusterSettings", [
            {
                Name: "containerInsights",
                Value: "enabled",
            },
        ]);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(aLBService.cluster, [
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
        cdk_nag_1.NagSuppressions.addResourceSuppressions(userPool, [
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
            .defaultChild;
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
            action: aws_elasticloadbalancingv2_1.ListenerAction.forward([aLBService.targetGroup]),
            conditions: [
                aws_elasticloadbalancingv2_1.ListenerCondition.pathPatterns([
                    "/manifest.json",
                    "/icons/*",
                    "/oauth2/*",
                ]),
            ],
            priority: 1,
        });
        aLBService.listener.addAction("cognito-rule", {
            action: new aws_elasticloadbalancingv2_actions_1.AuthenticateCognitoAction({
                userPool,
                userPoolClient,
                userPoolDomain,
                sessionTimeout: cdk.Duration.days(7),
                next: aws_elasticloadbalancingv2_1.ListenerAction.forward([aLBService.targetGroup]),
                onUnauthenticatedRequest: aws_elasticloadbalancingv2_1.UnauthenticatedAction.AUTHENTICATE,
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
exports.SonicBackendStack = SonicBackendStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFja2VuZC1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImJhY2tlbmQtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBRW5DLG1FQUFxRjtBQUNyRixpREFBMEU7QUFDMUUsdUZBS2dEO0FBQ2hELCtEQUF3RTtBQUN4RSxtREFBbUQ7QUFDbkQsbURBQW1EO0FBQ25ELDJDQUEyQztBQUMzQywyQ0FBMkM7QUFDM0MsNkJBQTZCO0FBQzdCLHVHQUEyRjtBQUUzRixpREFBOEU7QUFDOUUsaUNBQWlDO0FBQ2pDLDJCQUFrQztBQUNsQyxxQ0FBMEM7QUFRMUMsTUFBYSxpQkFBa0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUM5QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQWlCO1FBQ3pELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ3hCLE1BQU0sSUFBSSxHQUFHLEdBQUcsS0FBSyxDQUFDLE9BQU8sSUFBSSxLQUFLLENBQUMsVUFBVSxFQUFFLENBQUM7UUFFcEQsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLFVBQVUsQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRTtZQUN0RSxVQUFVLEVBQUUsS0FBSyxDQUFDLFVBQVU7U0FDN0IsQ0FBQyxDQUFDO1FBRUgsTUFBTSxTQUFTLEdBQUcsSUFBSSxpQ0FBZ0IsQ0FBQyxJQUFJLEVBQUUsb0JBQW9CLEVBQUU7WUFDakUsU0FBUyxFQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLElBQUksRUFBRSxRQUFRLENBQUM7WUFDL0MsUUFBUSxFQUFFLHlCQUFRLENBQUMsV0FBVztTQUMvQixDQUFDLENBQUM7UUFFSCxNQUFNLGVBQWUsR0FBRyxJQUFJLGNBQUksQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDeEQsU0FBUyxFQUFFLElBQUksMEJBQWdCLENBQUMseUJBQXlCLENBQUM7U0FD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cm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gXCJjb25zdHJ1Y3RzXCI7XG5pbXBvcnQgeyBBcHBsaWNhdGlvbkxvYWRCYWxhbmNlZEZhcmdhdGVTZXJ2aWNlIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1lY3MtcGF0dGVybnNcIjtcbmltcG9ydCB7IENvbnRhaW5lckltYWdlLCBTZWNyZXQgYXMgRWNzU2VjcmV0IH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1lY3NcIjtcbmltcG9ydCB7XG4gIEFwcGxpY2F0aW9uUHJvdG9jb2wsXG4gIExpc3RlbmVyQWN0aW9uLFxuICBMaXN0ZW5lckNvbmRpdGlvbixcbiAgVW5hdXRoZW50aWNhdGVkQWN0aW9uLFxufSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWVsYXN0aWNsb2FkYmFsYW5jaW5ndjJcIjtcbmltcG9ydCB7IERvY2tlckltYWdlQXNzZXQsIFBsYXRmb3JtIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1lY3ItYXNzZXRzXCI7XG5pbXBvcnQgKiBhcyBjb2duaXRvIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtY29nbml0b1wiO1xuaW1wb3J0ICogYXMgcm91dGU1MyBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXJvdXRlNTNcIjtcbmltcG9ydCAqIGFzIGVjMiBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWVjMlwiO1xuaW1wb3J0ICogYXMgc3NtIGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3NtXCI7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBBdXRoZW50aWNhdGVDb2duaXRvQWN0aW9uIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1lbGFzdGljbG9hZGJhbGFuY2luZ3YyLWFjdGlvbnNcIjtcblxuaW1wb3J0IHsgUm9sZSwgU2VydmljZVByaW5jaXBhbCwgUG9saWN5U3RhdGVtZW50IH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1pYW1cIjtcbmltcG9ydCAqIGFzIGRvdGVudiBmcm9tIFwiZG90ZW52XCI7XG5pbXBvcnQgeyByZWFkRmlsZVN5bmMgfSBmcm9tIFwiZnNcIjtcbmltcG9ydCB7IE5hZ1N1cHByZXNzaW9ucyB9IGZyb20gXCJjZGstbmFnXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgZG9tYWluTmFtZTogc3RyaW5nO1xuICBhcGlOYW1lOiBzdHJpbmc7XG4gIGFjY2Vzc0xvZ2dpbmc/OiBib29sZWFuO1xufVxuXG5leHBvcnQgY2xhc3MgU29uaWNCYWNrZW5kU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuICAgIGNvbnN0IGZxZG4gPSBgJHtwcm9wcy5hcGlOYW1lfS4ke3Byb3BzLmRvbWFpbk5hbWV9YDtcblxuICAgIGNvbnN0IGhvc3RlZFpvbmVJZCA9IHJvdXRlNTMuSG9zdGVkWm9uZS5mcm9tTG9va3VwKHRoaXMsIFwiaG9zdGVkLXpvbmVcIiwge1xuICAgICAgZG9tYWluTmFtZTogcHJvcHMuZG9tYWluTmFtZSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGNvbnRhaW5lciA9IG5ldyBEb2NrZXJJbWFnZUFzc2V0KHRoaXMsIFwic29uaWMtc2VydmVyLWltYWdlXCIsIHtcbiAgICAgIGRpcmVjdG9yeTogcGF0aC5qb2luKF9fZGlybmFtZSwgXCIuLlwiLCBcImRvY2tlclwiKSxcbiAgICAgIHBsYXRmb3JtOiBQbGF0Zm9ybS5MSU5VWF9BTUQ2NCxcbiAgICB9KTtcblxuICAgIGNvbnN0IHNvbmljU2VydmVyUm9sZSA9IG5ldyBSb2xlKHRoaXMsIFwic29uaWNTZXJ2ZXJSb2xlXCIsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IFNlcnZpY2VQcmluY2lwYWwoXCJlY3MtdGFza3MuYW1hem9uYXdzLmNvbVwiKSxcbiAgICB9KTtcblxuICAgIHNvbmljU2VydmVyUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBjZGsuYXdzX2lhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgXCJiZWRyb2NrOkludm9rZU1vZGVsXCIsXG4gICAgICAgICAgXCJiZWRyb2NrOkludm9rZU1vZGVsV2l0aFJlc3BvbnNlU3RyZWFtXCIsXG4gICAgICAgICAgXCJiZWRyb2NrOkludm9rZU1vZGVsV2l0aEJpZGlyZWN0aW9uYWxTdHJlYW1cIixcbiAgICAgICAgXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgXCJhcm46YXdzOmJlZHJvY2s6dXMtZWFzdC0xOjpmb3VuZGF0aW9uLW1vZGVsL2FtYXpvbi5ub3ZhLXNvbmljLXYxOjBcIixcbiAgICAgICAgXSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIEFkZCBQYXJhbWV0ZXIgU3RvcmUgcGVybWlzc2lvbnMgZm9yIE1DUCB0b29sIGNvbmZpZ3VyYXRpb25cbiAgICBzb25pY1NlcnZlclJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgIFwic3NtOkdldFBhcmFtZXRlclwiLFxuICAgICAgICAgIFwic3NtOkdldFBhcmFtZXRlcnNcIixcbiAgICAgICAgICBcInNzbTpQdXRQYXJhbWV0ZXJcIixcbiAgICAgICAgICBcInNzbTpEZWxldGVQYXJhbWV0ZXJcIixcbiAgICAgICAgICBcInNzbTpEZXNjcmliZVBhcmFtZXRlcnNcIixcbiAgICAgICAgXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgYGFybjphd3M6c3NtOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpwYXJhbWV0ZXIvJHtwcm9wcy5hcGlOYW1lfS9tY3AvKmAsXG4gICAgICAgIF0sXG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyBBZGQgS01TIHBlcm1pc3Npb25zIGZvciBTZWN1cmVTdHJpbmcgZGVjcnlwdGlvbi9lbmNyeXB0aW9uXG4gICAgc29uaWNTZXJ2ZXJSb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFtcImttczpEZWNyeXB0XCIsIFwia21zOkVuY3J5cHRcIiwgXCJrbXM6RGVzY3JpYmVLZXlcIl0sXG4gICAgICAgIHJlc291cmNlczogW1wiKlwiXSxcbiAgICAgICAgY29uZGl0aW9uczoge1xuICAgICAgICAgIFN0cmluZ0VxdWFsczoge1xuICAgICAgICAgICAgXCJrbXM6VmlhU2VydmljZVwiOiBgc3NtLiR7dGhpcy5yZWdpb259LmFtYXpvbmF3cy5jb21gLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KVxuICAgICk7XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnNCeVBhdGgoXG4gICAgICB0aGlzLFxuICAgICAgXCIvU29uaWNCYWNrZW5kU3RhY2svc29uaWNTZXJ2ZXJSb2xlL0RlZmF1bHRQb2xpY3kvUmVzb3VyY2VcIixcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1JQU01XCIsXG4gICAgICAgICAgcmVhc29uOiBcIk5vIHdpbGRjYXJkXCIsXG4gICAgICAgIH0sXG4gICAgICBdXG4gICAgKTtcblxuICAgIC8vIENyZWF0ZSBwYXJhbWV0ZXJzIGluIFBhcmFtZXRlciBTdG9yZSB3aXRoIGVudmlyb25tZW50IHZhcmlhYmxlcyBmcm9tIC5lbnYgZmlsZVxuICAgIGNvbnN0IGVudlZhcnMgPSBkb3RlbnYucGFyc2UocmVhZEZpbGVTeW5jKFwiLi4vYXBpLy5lbnZcIikudG9TdHJpbmcoXCJ1dGY4XCIpKTtcbiAgICBjb25zdCBwYXJhbWV0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBzc20uU3RyaW5nUGFyYW1ldGVyPiA9IHt9O1xuXG4gICAgLy8gQ3JlYXRlIFNTTSBwYXJhbWV0ZXJzIGZvciBlYWNoIGVudmlyb25tZW50IHZhcmlhYmxlXG4gICAgT2JqZWN0LmVudHJpZXMoZW52VmFycykuZm9yRWFjaCgoW2tleSwgdmFsdWVdKSA9PiB7XG4gICAgICBwYXJhbWV0ZXJzW2tleV0gPSBuZXcgc3NtLlN0cmluZ1BhcmFtZXRlcih0aGlzLCBgQXBwRW52VmFyLSR7a2V5fWAsIHtcbiAgICAgICAgcGFyYW1ldGVyTmFtZTogYC8ke3Byb3BzLmFwaU5hbWV9L2Vudi8ke2tleX1gLFxuICAgICAgICBzdHJpbmdWYWx1ZTogdmFsdWUsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBgRW52aXJvbm1lbnQgdmFyaWFibGUgJHtrZXl9IGZvciAke3Byb3BzLmFwaU5hbWV9YCxcbiAgICAgICAgdGllcjogc3NtLlBhcmFtZXRlclRpZXIuU1RBTkRBUkQsXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IHRoZSB0YXNrIHJvbGUgcGVybWlzc2lvbiB0byByZWFkIHRoZSBwYXJhbWV0ZXJzXG4gICAgc29uaWNTZXJ2ZXJSb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFtcInNzbTpHZXRQYXJhbWV0ZXJzXCIsIFwic3NtOkdldFBhcmFtZXRlclwiXSxcbiAgICAgICAgcmVzb3VyY2VzOiBPYmplY3QudmFsdWVzKHBhcmFtZXRlcnMpLm1hcCgocGFyYW0pID0+IHBhcmFtLnBhcmFtZXRlckFybiksXG4gICAgICB9KVxuICAgICk7XG5cbiAgICBjb25zdCBhTEJTZXJ2aWNlID0gbmV3IEFwcGxpY2F0aW9uTG9hZEJhbGFuY2VkRmFyZ2F0ZVNlcnZpY2UodGhpcywgXCJ0Z1wiLCB7XG4gICAgICBhc3NpZ25QdWJsaWNJcDogZmFsc2UsXG4gICAgICBkZXNpcmVkQ291bnQ6IDEsXG4gICAgICBkb21haW5OYW1lOiBmcWRuLFxuICAgICAgZG9tYWluWm9uZTogaG9zdGVkWm9uZUlkLFxuICAgICAgcHJvdG9jb2w6IEFwcGxpY2F0aW9uUHJvdG9jb2wuSFRUUFMsXG4gICAgICByZWRpcmVjdEhUVFA6IGZhbHNlLFxuICAgICAgdGFza0ltYWdlT3B0aW9uczoge1xuICAgICAgICBpbWFnZTogQ29udGFpbmVySW1hZ2UuZnJvbURvY2tlckltYWdlQXNzZXQoY29udGFpbmVyKSxcbiAgICAgICAgY29udGFpbmVyUG9ydDogMzAwMCxcbiAgICAgICAgdGFza1JvbGU6IHNvbmljU2VydmVyUm9sZSxcbiAgICAgICAgc2VjcmV0czogT2JqZWN0LmVudHJpZXMocGFyYW1ldGVycykucmVkdWNlKFxuICAgICAgICAgIChhY2MsIFtrZXksIHBhcmFtXSkgPT4ge1xuICAgICAgICAgICAgYWNjW2tleV0gPSBFY3NTZWNyZXQuZnJvbVNzbVBhcmFtZXRlcihwYXJhbSk7XG4gICAgICAgICAgICByZXR1cm4gYWNjO1xuICAgICAgICAgIH0sXG4gICAgICAgICAge30gYXMgUmVjb3JkPHN0cmluZywgRWNzU2VjcmV0PlxuICAgICAgICApLFxuICAgICAgfSxcbiAgICAgIGNwdTogMTAyNCxcbiAgICAgIG1lbW9yeUxpbWl0TWlCOiAyMDQ4LFxuICAgICAgZW5hYmxlRXhlY3V0ZUNvbW1hbmQ6IHRydWUsXG4gICAgfSk7XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnNCeVBhdGgoXG4gICAgICB0aGlzLFxuICAgICAgXCIvU29uaWNCYWNrZW5kU3RhY2svdGcvVGFza0RlZi9FeGVjdXRpb25Sb2xlL0RlZmF1bHRQb2xpY3kvUmVzb3VyY2VcIixcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1JQU01XCIsXG4gICAgICAgICAgcmVhc29uOiBcIlRoaXMgaXMgdGhlIGRlZmF1bHQgcm9sZVwiLFxuICAgICAgICB9LFxuICAgICAgXVxuICAgICk7XG5cbiAgICAvL1RoaXMgY2FuIGJlIGZ1cnRoZXIgcmVzdHJpY3RlZCB0byBhbGxvdyBlZ3Jlc3MgZnJvbSBMQiAtPiBhIHNlY3VyaXR5IGdyb3VwIHRoYXQgY29udHJvbHMgYWNjZXNzXG4gICAgLy9Gb3Igbm93IHdlJ3JlIGFsbG93aW5nIG91dGJvdW5kIDQ0MyB0byBhbnl3aGVyZSBzbyB0aGF0IHRoZSBMQiBjYW4gcmVhY2ggQ29nbml0byB0byB2ZXJpZnkgdG9rZW5zXG4gICAgYUxCU2VydmljZS5sb2FkQmFsYW5jZXIuY29ubmVjdGlvbnMuYWxsb3dUb0FueUlwdjQoXG4gICAgICBlYzIuUG9ydC50Y3AoNDQzKSxcbiAgICAgIFwiQWxsb3cgQUxCIHRvIHJlYWNoIENvZ25pdG8gdG8gdmVyaWZ5IHRva2Vuc1wiXG4gICAgKTtcblxuICAgIGFMQlNlcnZpY2UubG9hZEJhbGFuY2VyLmNvbm5lY3Rpb25zLmFsbG93RnJvbUFueUlwdjQoXG4gICAgICBlYzIuUG9ydC50Y3AoNDQzKSxcbiAgICAgIFwiQWxsb3cgYWNjZXNzIHRvIHRoZSBsb2FkIGJhbGFuY2VyXCJcbiAgICApO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zQnlQYXRoKFxuICAgICAgdGhpcyxcbiAgICAgIFwiL1NvbmljQmFja2VuZFN0YWNrL3RnL0xCL1NlY3VyaXR5R3JvdXAvUmVzb3VyY2VcIixcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1FQzIzXCIsXG4gICAgICAgICAgcmVhc29uOlxuICAgICAgICAgICAgXCJUaGlzIGlzIGEgcHVibGljLWZhY2luZyBsb2FkIGJhbGFuY2VyIHRoYXQgbmVlZHMgdG8gYmUgYWNjZXNzaWJsZSBvbiBIVFRQUyBwb3J0IDQ0M1wiLFxuICAgICAgICB9LFxuICAgICAgXVxuICAgICk7XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoYUxCU2VydmljZS5sb2FkQmFsYW5jZXIsIFtcbiAgICAgIHtcbiAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLUVMQjJcIixcbiAgICAgICAgcmVhc29uOiBcIlRoaXMgaXMgYSBsb2FkIGJhbGFuY2VyIGZvciBhIGRlbW8uXCIsXG4gICAgICB9LFxuICAgIF0pO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKGFMQlNlcnZpY2UuY2x1c3Rlci52cGMsIFtcbiAgICAgIHsgaWQ6IFwiQXdzU29sdXRpb25zLVZQQzdcIiwgcmVhc29uOiBcIlRoaXMgaXMgYSBkZW1vIFZQQ1wiIH0sXG4gICAgXSk7XG5cbiAgICBhTEJTZXJ2aWNlLnRhcmdldEdyb3VwLmNvbmZpZ3VyZUhlYWx0aENoZWNrKHtcbiAgICAgIHBhdGg6IFwiL2hlYWx0aFwiLFxuICAgICAgaGVhbHRoeUh0dHBDb2RlczogXCIyMDBcIixcbiAgICB9KTtcblxuICAgIC8vIEVuYWJsZSBDb250YWluZXIgSW5zaWdodHMgZm9yIHRoZSBjbHVzdGVyXG4gICAgY29uc3QgY2ZuQ2x1c3RlciA9IGFMQlNlcnZpY2UuY2x1c3Rlci5ub2RlXG4gICAgICAuZGVmYXVsdENoaWxkIGFzIGNkay5hd3NfZWNzLkNmbkNsdXN0ZXI7XG4gICAgY2ZuQ2x1c3Rlci5hZGRQcm9wZXJ0eU92ZXJyaWRlKFwiQ2x1c3RlclNldHRpbmdzXCIsIFtcbiAgICAgIHtcbiAgICAgICAgTmFtZTogXCJjb250YWluZXJJbnNpZ2h0c1wiLFxuICAgICAgICBWYWx1ZTogXCJlbmFibGVkXCIsXG4gICAgICB9LFxuICAgIF0pO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKGFMQlNlcnZpY2UuY2x1c3RlciwgW1xuICAgICAge1xuICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtRUNTNFwiLFxuICAgICAgICByZWFzb246IFwiVGhpcyBpcyBhIGRlbW8gY2x1c3Rlci5cIixcbiAgICAgIH0sXG4gICAgXSk7XG5cbiAgICAvL0NvZ25pdG8gcmVzb3VyY2VzXG4gICAgLy9UT0RPOiBBbGxvdyB1c2VycyB0byBwcm92aWRlIHRoZWlyIG93biB1c2VyIHBvb2xcbiAgICBjb25zdCB1c2VyUG9vbCA9IG5ldyBjb2duaXRvLlVzZXJQb29sKHRoaXMsIFwiU29uaWNVc2VyUG9vbFwiLCB7XG4gICAgICBmZWF0dXJlUGxhbjogY29nbml0by5GZWF0dXJlUGxhbi5FU1NFTlRJQUxTLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIHBhc3N3b3JkUG9saWN5OiB7XG4gICAgICAgIG1pbkxlbmd0aDogOCxcbiAgICAgICAgcmVxdWlyZURpZ2l0czogdHJ1ZSxcbiAgICAgICAgcmVxdWlyZUxvd2VyY2FzZTogdHJ1ZSxcbiAgICAgICAgcmVxdWlyZVN5bWJvbHM6IHRydWUsXG4gICAgICAgIHJlcXVpcmVVcHBlcmNhc2U6IHRydWUsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKHVzZXJQb29sLCBbXG4gICAgICB7XG4gICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1DT0cyXCIsXG4gICAgICAgIHJlYXNvbjogXCJUaGlzIGlzIGEgZGVtbyBhcHBsaWNhdGlvbi5cIixcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1DT0czXCIsXG4gICAgICAgIHJlYXNvbjogXCJUaGlzIGlzIGEgZGVtbyBhcHBsaWNhdGlvbi5cIixcbiAgICAgIH0sXG4gICAgXSk7XG5cbiAgICBjb25zdCB1c2VyUG9vbENsaWVudCA9IG5ldyBjb2duaXRvLlVzZXJQb29sQ2xpZW50KHRoaXMsIFwiQ2xpZW50XCIsIHtcbiAgICAgIHVzZXJQb29sLFxuICAgICAgLy8gUmVxdWlyZWQgbWluaW1hbCBjb25maWd1cmF0aW9uIGZvciB1c2Ugd2l0aCBhbiBFTEJcbiAgICAgIGdlbmVyYXRlU2VjcmV0OiB0cnVlLFxuICAgICAgYXV0aEZsb3dzOiB7XG4gICAgICAgIHVzZXJQYXNzd29yZDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBvQXV0aDoge1xuICAgICAgICBmbG93czoge1xuICAgICAgICAgIGF1dGhvcml6YXRpb25Db2RlR3JhbnQ6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIHNjb3BlczogW2NvZ25pdG8uT0F1dGhTY29wZS5FTUFJTF0sXG4gICAgICAgIGNhbGxiYWNrVXJsczogW2BodHRwczovLyR7ZnFkbn0vb2F1dGgyL2lkcHJlc3BvbnNlYF0sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgY29uc3QgY2ZuQ2xpZW50ID0gdXNlclBvb2xDbGllbnQubm9kZVxuICAgICAgLmRlZmF1bHRDaGlsZCBhcyBjb2duaXRvLkNmblVzZXJQb29sQ2xpZW50O1xuICAgIGNmbkNsaWVudC5hZGRQcm9wZXJ0eU92ZXJyaWRlKFwiUmVmcmVzaFRva2VuVmFsaWRpdHlcIiwgNyk7XG4gICAgY2ZuQ2xpZW50LmFkZFByb3BlcnR5T3ZlcnJpZGUoXCJTdXBwb3J0ZWRJZGVudGl0eVByb3ZpZGVyc1wiLCBbXCJDT0dOSVRPXCJdKTtcblxuICAgIGNvbnN0IHVzZXJQb29sRG9tYWluID0gbmV3IGNvZ25pdG8uVXNlclBvb2xEb21haW4odGhpcywgXCJEb21haW5cIiwge1xuICAgICAgdXNlclBvb2wsXG4gICAgICBjb2duaXRvRG9tYWluOiB7XG4gICAgICAgIGRvbWFpblByZWZpeDogYCR7cHJvcHMuYXBpTmFtZX0tdXNlcnNgLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vQ29nbml0byByZXNvdXJjZXNcbiAgICAvL0FsbCByZXF1ZXN0cyB0byBiZSBhdXRoZW50aWNhdGVkIGJ5IENvZ25pdG9cbiAgICBhTEJTZXJ2aWNlLmxpc3RlbmVyLmFkZEFjdGlvbihcIm1hbmlmZXN0LWpzb25cIiwge1xuICAgICAgYWN0aW9uOiBMaXN0ZW5lckFjdGlvbi5mb3J3YXJkKFthTEJTZXJ2aWNlLnRhcmdldEdyb3VwXSksXG4gICAgICBjb25kaXRpb25zOiBbXG4gICAgICAgIExpc3RlbmVyQ29uZGl0aW9uLnBhdGhQYXR0ZXJucyhbXG4gICAgICAgICAgXCIvbWFuaWZlc3QuanNvblwiLFxuICAgICAgICAgIFwiL2ljb25zLypcIixcbiAgICAgICAgICBcIi9vYXV0aDIvKlwiLFxuICAgICAgICBdKSxcbiAgICAgIF0sXG4gICAgICBwcmlvcml0eTogMSxcbiAgICB9KTtcbiAgICBhTEJTZXJ2aWNlLmxpc3RlbmVyLmFkZEFjdGlvbihcImNvZ25pdG8tcnVsZVwiLCB7XG4gICAgICBhY3Rpb246IG5ldyBBdXRoZW50aWNhdGVDb2duaXRvQWN0aW9uKHtcbiAgICAgICAgdXNlclBvb2wsXG4gICAgICAgIHVzZXJQb29sQ2xpZW50LFxuICAgICAgICB1c2VyUG9vbERvbWFpbixcbiAgICAgICAgc2Vzc2lvblRpbWVvdXQ6IGNkay5EdXJhdGlvbi5kYXlzKDcpLFxuICAgICAgICBuZXh0OiBMaXN0ZW5lckFjdGlvbi5mb3J3YXJkKFthTEJTZXJ2aWNlLnRhcmdldEdyb3VwXSksXG4gICAgICAgIG9uVW5hdXRoZW50aWNhdGVkUmVxdWVzdDogVW5hdXRoZW50aWNhdGVkQWN0aW9uLkFVVEhFTlRJQ0FURSxcbiAgICAgIH0pLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJVc2VyUG9vbFwiLCB7XG4gICAgICBkZXNjcmlwdGlvbjogXCJBbWF6b24gQ29nbml0byBVc2VyUG9vbCBVc2VyIG1hbmFnZW1lbnQgY29uc29sZVwiLFxuICAgICAgdmFsdWU6IGBodHRwczovL2NvbnNvbGUuYXdzLmFtYXpvbi5jb20vY29nbml0by92Mi9pZHAvdXNlci1wb29scy8ke3VzZXJQb29sLnVzZXJQb29sSWR9L3VzZXItbWFuYWdlbWVudC91c2Vyc2AsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkFwcFVSTFwiLCB7XG4gICAgICBkZXNjcmlwdGlvbjogXCJBcHBsaWNhdGlvbiBVUkxcIixcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke2ZxZG59YCxcbiAgICB9KTtcbiAgfVxufVxuIl19