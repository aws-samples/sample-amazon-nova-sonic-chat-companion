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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFja2VuZC1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImJhY2tlbmQtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBRW5DLG1FQUFxRjtBQUNyRixpREFBMEU7QUFDMUUsdUZBS2dEO0FBQ2hELCtEQUF3RTtBQUN4RSxtREFBbUQ7QUFDbkQsbURBQW1EO0FBQ25ELDJDQUEyQztBQUMzQywyQ0FBMkM7QUFDM0MsNkJBQTZCO0FBQzdCLHVHQUEyRjtBQUUzRixpREFBOEU7QUFDOUUsaUNBQWlDO0FBQ2pDLDJCQUFrQztBQUNsQyxxQ0FBMEM7QUFRMUMsTUFBYSxpQkFBa0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUM5QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQWlCO1FBQ3pELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ3hCLE1BQU0sSUFBSSxHQUFHLEdBQUcsS0FBSyxDQUFDLE9BQU8sSUFBSSxLQUFLLENBQUMsVUFBVSxFQUFFLENBQUM7UUFFcEQsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLFVBQVUsQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRTtZQUN0RSxVQUFVLEVBQUUsS0FBSyxDQUFDLFVBQVU7U0FDN0IsQ0FBQyxDQUFDO1FBRUgsTUFBTSxTQUFTLEdBQUcsSUFBSSxpQ0FBZ0IsQ0FBQyxJQUFJLEVBQUUsb0JBQW9CLEVBQUU7WUFDakUsU0FBUyxFQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLElBQUksRUFBRSxRQUFRLENBQUM7WUFDL0MsUUFBUSxFQUFFLHlCQUFRLENBQUMsV0FBVztTQUMvQixDQUFDLENBQUM7UUFFSCxNQUFNLGVBQWUsR0FBRyxJQUFJLGNBQUksQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDeEQsU0FBUyxFQUFFLElBQUksMEJBQWdCLENBQUMseUJBQXlCLENBQUM7U0FD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QVcsQ0FBQyxDQUFDO2dCQUN0RCx3QkFBd0IsRUFBRSxrREFBcUIsQ0FBQyxZQUFZO2FBQzdELENBQUM7U0FDSCxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFVBQVUsRUFBRTtZQUNsQyxXQUFXLEVBQUUsaURBQWlEO1lBQzlELEtBQUssRUFBRSw0REFBNEQsUUFBUSxDQUFDLFVBQVUsd0JBQXdCO1NBQy9HLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsUUFBUSxFQUFFO1lBQ2hDLFdBQVcsRUFBRSxpQkFBaUI7WUFDOUIsS0FBSyxFQUFFLFdBQVcsSUFBSSxFQUFFO1NBQ3pCLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQW5QRCw4Q0FtUEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tIFwiY29uc3RydWN0c1wiO1xuaW1wb3J0IHsgQXBwbGljYXRpb25Mb2FkQmFsYW5jZWRGYXJnYXRlU2VydmljZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZWNzLXBhdHRlcm5zXCI7XG5pbXBvcnQgeyBDb250YWluZXJJbWFnZSwgU2VjcmV0IGFzIEVjc1NlY3JldCB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZWNzXCI7XG5pbXBvcnQge1xuICBBcHBsaWNhdGlvblByb3RvY29sLFxuICBMaXN0ZW5lckFjdGlvbixcbiAgTGlzdGVuZXJDb25kaXRpb24sXG4gIFVuYXV0aGVudGljYXRlZEFjdGlvbixcbn0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1lbGFzdGljbG9hZGJhbGFuY2luZ3YyXCI7XG5pbXBvcnQgeyBEb2NrZXJJbWFnZUFzc2V0LCBQbGF0Zm9ybSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZWNyLWFzc2V0c1wiO1xuaW1wb3J0ICogYXMgY29nbml0byBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWNvZ25pdG9cIjtcbmltcG9ydCAqIGFzIHJvdXRlNTMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1yb3V0ZTUzXCI7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSBcImF3cy1jZGstbGliL2F3cy1lYzJcIjtcbmltcG9ydCAqIGFzIHNzbSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXNzbVwiO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgQXV0aGVudGljYXRlQ29nbml0b0FjdGlvbiB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZWxhc3RpY2xvYWRiYWxhbmNpbmd2Mi1hY3Rpb25zXCI7XG5cbmltcG9ydCB7IFJvbGUsIFNlcnZpY2VQcmluY2lwYWwsIFBvbGljeVN0YXRlbWVudCB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtaWFtXCI7XG5pbXBvcnQgKiBhcyBkb3RlbnYgZnJvbSBcImRvdGVudlwiO1xuaW1wb3J0IHsgcmVhZEZpbGVTeW5jIH0gZnJvbSBcImZzXCI7XG5pbXBvcnQgeyBOYWdTdXBwcmVzc2lvbnMgfSBmcm9tIFwiY2RrLW5hZ1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIFN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIGRvbWFpbk5hbWU6IHN0cmluZztcbiAgYXBpTmFtZTogc3RyaW5nO1xuICBhY2Nlc3NMb2dnaW5nPzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGNsYXNzIFNvbmljQmFja2VuZFN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IFN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcbiAgICBjb25zdCBmcWRuID0gYCR7cHJvcHMuYXBpTmFtZX0uJHtwcm9wcy5kb21haW5OYW1lfWA7XG5cbiAgICBjb25zdCBob3N0ZWRab25lSWQgPSByb3V0ZTUzLkhvc3RlZFpvbmUuZnJvbUxvb2t1cCh0aGlzLCBcImhvc3RlZC16b25lXCIsIHtcbiAgICAgIGRvbWFpbk5hbWU6IHByb3BzLmRvbWFpbk5hbWUsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb250YWluZXIgPSBuZXcgRG9ja2VySW1hZ2VBc3NldCh0aGlzLCBcInNvbmljLXNlcnZlci1pbWFnZVwiLCB7XG4gICAgICBkaXJlY3Rvcnk6IHBhdGguam9pbihfX2Rpcm5hbWUsIFwiLi5cIiwgXCJkb2NrZXJcIiksXG4gICAgICBwbGF0Zm9ybTogUGxhdGZvcm0uTElOVVhfQU1ENjQsXG4gICAgfSk7XG5cbiAgICBjb25zdCBzb25pY1NlcnZlclJvbGUgPSBuZXcgUm9sZSh0aGlzLCBcInNvbmljU2VydmVyUm9sZVwiLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBTZXJ2aWNlUHJpbmNpcGFsKFwiZWNzLXRhc2tzLmFtYXpvbmF3cy5jb21cIiksXG4gICAgfSk7XG5cbiAgICBzb25pY1NlcnZlclJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgY2RrLmF3c19pYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgIFwiYmVkcm9jazpJbnZva2VNb2RlbFwiLFxuICAgICAgICAgIFwiYmVkcm9jazpJbnZva2VNb2RlbFdpdGhSZXNwb25zZVN0cmVhbVwiLFxuICAgICAgICAgIFwiYmVkcm9jazpJbnZva2VNb2RlbFdpdGhCaWRpcmVjdGlvbmFsU3RyZWFtXCIsXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgIFwiYXJuOmF3czpiZWRyb2NrOnVzLWVhc3QtMTo6Zm91bmRhdGlvbi1tb2RlbC9hbWF6b24ubm92YS1zb25pYy12MTowXCIsXG4gICAgICAgIF0sXG4gICAgICB9KVxuICAgICk7XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnNCeVBhdGgoXG4gICAgICB0aGlzLFxuICAgICAgXCIvU29uaWNCYWNrZW5kU3RhY2svc29uaWNTZXJ2ZXJSb2xlL0RlZmF1bHRQb2xpY3kvUmVzb3VyY2VcIixcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1JQU01XCIsXG4gICAgICAgICAgcmVhc29uOiBcIk5vIHdpbGRjYXJkXCIsXG4gICAgICAgIH0sXG4gICAgICBdXG4gICAgKTtcblxuICAgIC8vIENyZWF0ZSBwYXJhbWV0ZXJzIGluIFBhcmFtZXRlciBTdG9yZSB3aXRoIGVudmlyb25tZW50IHZhcmlhYmxlcyBmcm9tIC5lbnYgZmlsZVxuICAgIGNvbnN0IGVudlZhcnMgPSBkb3RlbnYucGFyc2UocmVhZEZpbGVTeW5jKFwiLi4vYXBpLy5lbnZcIikudG9TdHJpbmcoXCJ1dGY4XCIpKTtcbiAgICBjb25zdCBwYXJhbWV0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBzc20uU3RyaW5nUGFyYW1ldGVyPiA9IHt9O1xuXG4gICAgLy8gQ3JlYXRlIFNTTSBwYXJhbWV0ZXJzIGZvciBlYWNoIGVudmlyb25tZW50IHZhcmlhYmxlXG4gICAgT2JqZWN0LmVudHJpZXMoZW52VmFycykuZm9yRWFjaCgoW2tleSwgdmFsdWVdKSA9PiB7XG4gICAgICBwYXJhbWV0ZXJzW2tleV0gPSBuZXcgc3NtLlN0cmluZ1BhcmFtZXRlcih0aGlzLCBgQXBwRW52VmFyLSR7a2V5fWAsIHtcbiAgICAgICAgcGFyYW1ldGVyTmFtZTogYC8ke3Byb3BzLmFwaU5hbWV9L2Vudi8ke2tleX1gLFxuICAgICAgICBzdHJpbmdWYWx1ZTogdmFsdWUsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBgRW52aXJvbm1lbnQgdmFyaWFibGUgJHtrZXl9IGZvciAke3Byb3BzLmFwaU5hbWV9YCxcbiAgICAgICAgdGllcjogc3NtLlBhcmFtZXRlclRpZXIuU1RBTkRBUkQsXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IHRoZSB0YXNrIHJvbGUgcGVybWlzc2lvbiB0byByZWFkIHRoZSBwYXJhbWV0ZXJzXG4gICAgc29uaWNTZXJ2ZXJSb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFtcInNzbTpHZXRQYXJhbWV0ZXJzXCIsIFwic3NtOkdldFBhcmFtZXRlclwiXSxcbiAgICAgICAgcmVzb3VyY2VzOiBPYmplY3QudmFsdWVzKHBhcmFtZXRlcnMpLm1hcCgocGFyYW0pID0+IHBhcmFtLnBhcmFtZXRlckFybiksXG4gICAgICB9KVxuICAgICk7XG5cbiAgICBjb25zdCBhTEJTZXJ2aWNlID0gbmV3IEFwcGxpY2F0aW9uTG9hZEJhbGFuY2VkRmFyZ2F0ZVNlcnZpY2UodGhpcywgXCJ0Z1wiLCB7XG4gICAgICBhc3NpZ25QdWJsaWNJcDogZmFsc2UsXG4gICAgICBkZXNpcmVkQ291bnQ6IDEsXG4gICAgICBkb21haW5OYW1lOiBmcWRuLFxuICAgICAgZG9tYWluWm9uZTogaG9zdGVkWm9uZUlkLFxuICAgICAgcHJvdG9jb2w6IEFwcGxpY2F0aW9uUHJvdG9jb2wuSFRUUFMsXG4gICAgICByZWRpcmVjdEhUVFA6IGZhbHNlLFxuICAgICAgdGFza0ltYWdlT3B0aW9uczoge1xuICAgICAgICBpbWFnZTogQ29udGFpbmVySW1hZ2UuZnJvbURvY2tlckltYWdlQXNzZXQoY29udGFpbmVyKSxcbiAgICAgICAgY29udGFpbmVyUG9ydDogMzAwMCxcbiAgICAgICAgdGFza1JvbGU6IHNvbmljU2VydmVyUm9sZSxcbiAgICAgICAgc2VjcmV0czogT2JqZWN0LmVudHJpZXMocGFyYW1ldGVycykucmVkdWNlKFxuICAgICAgICAgIChhY2MsIFtrZXksIHBhcmFtXSkgPT4ge1xuICAgICAgICAgICAgYWNjW2tleV0gPSBFY3NTZWNyZXQuZnJvbVNzbVBhcmFtZXRlcihwYXJhbSk7XG4gICAgICAgICAgICByZXR1cm4gYWNjO1xuICAgICAgICAgIH0sXG4gICAgICAgICAge30gYXMgUmVjb3JkPHN0cmluZywgRWNzU2VjcmV0PlxuICAgICAgICApLFxuICAgICAgfSxcbiAgICAgIGNwdTogMTAyNCxcbiAgICAgIG1lbW9yeUxpbWl0TWlCOiAyMDQ4LFxuICAgICAgZW5hYmxlRXhlY3V0ZUNvbW1hbmQ6IHRydWUsXG4gICAgfSk7XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnNCeVBhdGgoXG4gICAgICB0aGlzLFxuICAgICAgXCIvU29uaWNCYWNrZW5kU3RhY2svdGcvVGFza0RlZi9FeGVjdXRpb25Sb2xlL0RlZmF1bHRQb2xpY3kvUmVzb3VyY2VcIixcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1JQU01XCIsXG4gICAgICAgICAgcmVhc29uOiBcIlRoaXMgaXMgdGhlIGRlZmF1bHQgcm9sZVwiLFxuICAgICAgICB9LFxuICAgICAgXVxuICAgICk7XG5cbiAgICAvL1RoaXMgY2FuIGJlIGZ1cnRoZXIgcmVzdHJpY3RlZCB0byBhbGxvdyBlZ3Jlc3MgZnJvbSBMQiAtPiBhIHNlY3VyaXR5IGdyb3VwIHRoYXQgY29udHJvbHMgYWNjZXNzXG4gICAgLy9Gb3Igbm93IHdlJ3JlIGFsbG93aW5nIG91dGJvdW5kIDQ0MyB0byBhbnl3aGVyZSBzbyB0aGF0IHRoZSBMQiBjYW4gcmVhY2ggQ29nbml0byB0byB2ZXJpZnkgdG9rZW5zXG4gICAgYUxCU2VydmljZS5sb2FkQmFsYW5jZXIuY29ubmVjdGlvbnMuYWxsb3dUb0FueUlwdjQoXG4gICAgICBlYzIuUG9ydC50Y3AoNDQzKSxcbiAgICAgIFwiQWxsb3cgQUxCIHRvIHJlYWNoIENvZ25pdG8gdG8gdmVyaWZ5IHRva2Vuc1wiXG4gICAgKTtcblxuICAgIGFMQlNlcnZpY2UubG9hZEJhbGFuY2VyLmNvbm5lY3Rpb25zLmFsbG93RnJvbUFueUlwdjQoXG4gICAgICBlYzIuUG9ydC50Y3AoNDQzKSxcbiAgICAgIFwiQWxsb3cgYWNjZXNzIHRvIHRoZSBsb2FkIGJhbGFuY2VyXCJcbiAgICApO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zQnlQYXRoKFxuICAgICAgdGhpcyxcbiAgICAgIFwiL1NvbmljQmFja2VuZFN0YWNrL3RnL0xCL1NlY3VyaXR5R3JvdXAvUmVzb3VyY2VcIixcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1FQzIzXCIsXG4gICAgICAgICAgcmVhc29uOlxuICAgICAgICAgICAgXCJUaGlzIGlzIGEgcHVibGljLWZhY2luZyBsb2FkIGJhbGFuY2VyIHRoYXQgbmVlZHMgdG8gYmUgYWNjZXNzaWJsZSBvbiBIVFRQUyBwb3J0IDQ0M1wiLFxuICAgICAgICB9LFxuICAgICAgXVxuICAgICk7XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoYUxCU2VydmljZS5sb2FkQmFsYW5jZXIsIFtcbiAgICAgIHtcbiAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLUVMQjJcIixcbiAgICAgICAgcmVhc29uOiBcIlRoaXMgaXMgYSBsb2FkIGJhbGFuY2VyIGZvciBhIGRlbW8uXCIsXG4gICAgICB9LFxuICAgIF0pO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKGFMQlNlcnZpY2UuY2x1c3Rlci52cGMsIFtcbiAgICAgIHsgaWQ6IFwiQXdzU29sdXRpb25zLVZQQzdcIiwgcmVhc29uOiBcIlRoaXMgaXMgYSBkZW1vIFZQQ1wiIH0sXG4gICAgXSk7XG5cbiAgICBhTEJTZXJ2aWNlLnRhcmdldEdyb3VwLmNvbmZpZ3VyZUhlYWx0aENoZWNrKHtcbiAgICAgIHBhdGg6IFwiL2hlYWx0aFwiLFxuICAgICAgaGVhbHRoeUh0dHBDb2RlczogXCIyMDBcIixcbiAgICB9KTtcblxuICAgIC8vIEVuYWJsZSBDb250YWluZXIgSW5zaWdodHMgZm9yIHRoZSBjbHVzdGVyXG4gICAgY29uc3QgY2ZuQ2x1c3RlciA9IGFMQlNlcnZpY2UuY2x1c3Rlci5ub2RlXG4gICAgICAuZGVmYXVsdENoaWxkIGFzIGNkay5hd3NfZWNzLkNmbkNsdXN0ZXI7XG4gICAgY2ZuQ2x1c3Rlci5hZGRQcm9wZXJ0eU92ZXJyaWRlKFwiQ2x1c3RlclNldHRpbmdzXCIsIFtcbiAgICAgIHtcbiAgICAgICAgTmFtZTogXCJjb250YWluZXJJbnNpZ2h0c1wiLFxuICAgICAgICBWYWx1ZTogXCJlbmFibGVkXCIsXG4gICAgICB9LFxuICAgIF0pO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKGFMQlNlcnZpY2UuY2x1c3RlciwgW1xuICAgICAge1xuICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtRUNTNFwiLFxuICAgICAgICByZWFzb246IFwiVGhpcyBpcyBhIGRlbW8gY2x1c3Rlci5cIixcbiAgICAgIH0sXG4gICAgXSk7XG5cbiAgICAvL0NvZ25pdG8gcmVzb3VyY2VzXG4gICAgLy9UT0RPOiBBbGxvdyB1c2VycyB0byBwcm92aWRlIHRoZWlyIG93biB1c2VyIHBvb2xcbiAgICBjb25zdCB1c2VyUG9vbCA9IG5ldyBjb2duaXRvLlVzZXJQb29sKHRoaXMsIFwiU29uaWNVc2VyUG9vbFwiLCB7XG4gICAgICBmZWF0dXJlUGxhbjogY29nbml0by5GZWF0dXJlUGxhbi5FU1NFTlRJQUxTLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIHBhc3N3b3JkUG9saWN5OiB7XG4gICAgICAgIG1pbkxlbmd0aDogOCxcbiAgICAgICAgcmVxdWlyZURpZ2l0czogdHJ1ZSxcbiAgICAgICAgcmVxdWlyZUxvd2VyY2FzZTogdHJ1ZSxcbiAgICAgICAgcmVxdWlyZVN5bWJvbHM6IHRydWUsXG4gICAgICAgIHJlcXVpcmVVcHBlcmNhc2U6IHRydWUsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKHVzZXJQb29sLCBbXG4gICAgICB7XG4gICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1DT0cyXCIsXG4gICAgICAgIHJlYXNvbjogXCJUaGlzIGlzIGEgZGVtbyBhcHBsaWNhdGlvbi5cIixcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1DT0czXCIsXG4gICAgICAgIHJlYXNvbjogXCJUaGlzIGlzIGEgZGVtbyBhcHBsaWNhdGlvbi5cIixcbiAgICAgIH0sXG4gICAgXSk7XG5cbiAgICBjb25zdCB1c2VyUG9vbENsaWVudCA9IG5ldyBjb2duaXRvLlVzZXJQb29sQ2xpZW50KHRoaXMsIFwiQ2xpZW50XCIsIHtcbiAgICAgIHVzZXJQb29sLFxuICAgICAgLy8gUmVxdWlyZWQgbWluaW1hbCBjb25maWd1cmF0aW9uIGZvciB1c2Ugd2l0aCBhbiBFTEJcbiAgICAgIGdlbmVyYXRlU2VjcmV0OiB0cnVlLFxuICAgICAgYXV0aEZsb3dzOiB7XG4gICAgICAgIHVzZXJQYXNzd29yZDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBvQXV0aDoge1xuICAgICAgICBmbG93czoge1xuICAgICAgICAgIGF1dGhvcml6YXRpb25Db2RlR3JhbnQ6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIHNjb3BlczogW2NvZ25pdG8uT0F1dGhTY29wZS5FTUFJTF0sXG4gICAgICAgIGNhbGxiYWNrVXJsczogW2BodHRwczovLyR7ZnFkbn0vb2F1dGgyL2lkcHJlc3BvbnNlYF0sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgY29uc3QgY2ZuQ2xpZW50ID0gdXNlclBvb2xDbGllbnQubm9kZVxuICAgICAgLmRlZmF1bHRDaGlsZCBhcyBjb2duaXRvLkNmblVzZXJQb29sQ2xpZW50O1xuICAgIGNmbkNsaWVudC5hZGRQcm9wZXJ0eU92ZXJyaWRlKFwiUmVmcmVzaFRva2VuVmFsaWRpdHlcIiwgNyk7XG4gICAgY2ZuQ2xpZW50LmFkZFByb3BlcnR5T3ZlcnJpZGUoXCJTdXBwb3J0ZWRJZGVudGl0eVByb3ZpZGVyc1wiLCBbXCJDT0dOSVRPXCJdKTtcblxuICAgIGNvbnN0IHVzZXJQb29sRG9tYWluID0gbmV3IGNvZ25pdG8uVXNlclBvb2xEb21haW4odGhpcywgXCJEb21haW5cIiwge1xuICAgICAgdXNlclBvb2wsXG4gICAgICBjb2duaXRvRG9tYWluOiB7XG4gICAgICAgIGRvbWFpblByZWZpeDogYCR7cHJvcHMuYXBpTmFtZX0tdXNlcnNgLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vQ29nbml0byByZXNvdXJjZXNcbiAgICAvL0FsbCByZXF1ZXN0cyB0byBiZSBhdXRoZW50aWNhdGVkIGJ5IENvZ25pdG9cbiAgICBhTEJTZXJ2aWNlLmxpc3RlbmVyLmFkZEFjdGlvbihcIm1hbmlmZXN0LWpzb25cIiwge1xuICAgICAgYWN0aW9uOiBMaXN0ZW5lckFjdGlvbi5mb3J3YXJkKFthTEJTZXJ2aWNlLnRhcmdldEdyb3VwXSksXG4gICAgICBjb25kaXRpb25zOiBbXG4gICAgICAgIExpc3RlbmVyQ29uZGl0aW9uLnBhdGhQYXR0ZXJucyhbXG4gICAgICAgICAgXCIvbWFuaWZlc3QuanNvblwiLFxuICAgICAgICAgIFwiL2ljb25zLypcIixcbiAgICAgICAgICBcIi9vYXV0aDIvKlwiLFxuICAgICAgICBdKSxcbiAgICAgIF0sXG4gICAgICBwcmlvcml0eTogMSxcbiAgICB9KTtcbiAgICBhTEJTZXJ2aWNlLmxpc3RlbmVyLmFkZEFjdGlvbihcImNvZ25pdG8tcnVsZVwiLCB7XG4gICAgICBhY3Rpb246IG5ldyBBdXRoZW50aWNhdGVDb2duaXRvQWN0aW9uKHtcbiAgICAgICAgdXNlclBvb2wsXG4gICAgICAgIHVzZXJQb29sQ2xpZW50LFxuICAgICAgICB1c2VyUG9vbERvbWFpbixcbiAgICAgICAgc2Vzc2lvblRpbWVvdXQ6IGNkay5EdXJhdGlvbi5kYXlzKDcpLFxuICAgICAgICBuZXh0OiBMaXN0ZW5lckFjdGlvbi5mb3J3YXJkKFthTEJTZXJ2aWNlLnRhcmdldEdyb3VwXSksXG4gICAgICAgIG9uVW5hdXRoZW50aWNhdGVkUmVxdWVzdDogVW5hdXRoZW50aWNhdGVkQWN0aW9uLkFVVEhFTlRJQ0FURSxcbiAgICAgIH0pLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJVc2VyUG9vbFwiLCB7XG4gICAgICBkZXNjcmlwdGlvbjogXCJBbWF6b24gQ29nbml0byBVc2VyUG9vbCBVc2VyIG1hbmFnZW1lbnQgY29uc29sZVwiLFxuICAgICAgdmFsdWU6IGBodHRwczovL2NvbnNvbGUuYXdzLmFtYXpvbi5jb20vY29nbml0by92Mi9pZHAvdXNlci1wb29scy8ke3VzZXJQb29sLnVzZXJQb29sSWR9L3VzZXItbWFuYWdlbWVudC91c2Vyc2AsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkFwcFVSTFwiLCB7XG4gICAgICBkZXNjcmlwdGlvbjogXCJBcHBsaWNhdGlvbiBVUkxcIixcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke2ZxZG59YCxcbiAgICB9KTtcbiAgfVxufVxuIl19