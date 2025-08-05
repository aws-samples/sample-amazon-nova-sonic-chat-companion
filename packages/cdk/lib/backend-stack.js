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
    }
}
exports.SonicBackendStack = SonicBackendStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFja2VuZC1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImJhY2tlbmQtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBRW5DLG1FQUFxRjtBQUNyRixpREFBMEU7QUFDMUUsdUZBS2dEO0FBQ2hELCtEQUF3RTtBQUN4RSxtREFBbUQ7QUFDbkQsbURBQW1EO0FBQ25ELDJDQUEyQztBQUMzQywyQ0FBMkM7QUFDM0MsNkJBQTZCO0FBQzdCLHVHQUEyRjtBQUUzRixpREFBOEU7QUFHOUUsaUNBQWlDO0FBQ2pDLDJCQUFrQztBQUNsQyxxQ0FBMEM7QUFTMUMsTUFBYSxpQkFBa0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUM5QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQTBCO1FBQ2xFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ3hCLE1BQU0sSUFBSSxHQUFHLEdBQUcsS0FBSyxDQUFDLE9BQU8sSUFBSSxLQUFLLENBQUMsVUFBVSxFQUFFLENBQUM7UUFFcEQsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLFVBQVUsQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRTtZQUN0RSxVQUFVLEVBQUUsS0FBSyxDQUFDLFVBQVU7U0FDN0IsQ0FBQyxDQUFDO1FBRUgsTUFBTSxTQUFTLEdBQUcsSUFBSSxpQ0FBZ0IsQ0FBQyxJQUFJLEVBQUUsb0JBQW9CLEVBQUU7WUFDakUsU0FBUyxFQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLElBQUksRUFBRSxRQUFRLENBQUM7WUFDL0MsUUFBUSxFQUFFLHlCQUFRLENBQUMsV0FBVztTQUMvQixDQUFDLENBQUM7UUFFSCxNQUFNLGVBQWUsR0FBRyxJQUFJLGNBQUksQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDeEQsU0FBUyxFQUFFLElBQUksMEJBQWdCLENBQUMseUJBQXlCLENBQUM7U0FD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QVcsQ0FBQyxDQUFDO2dCQUN0RCx3QkFBd0IsRUFBRSxrREFBcUIsQ0FBQyxZQUFZO2FBQzdELENBQUM7U0FDSCxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUF6T0QsOENBeU9DIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcbmltcG9ydCB7IEFwcGxpY2F0aW9uTG9hZEJhbGFuY2VkRmFyZ2F0ZVNlcnZpY2UgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWVjcy1wYXR0ZXJuc1wiO1xuaW1wb3J0IHsgQ29udGFpbmVySW1hZ2UsIFNlY3JldCBhcyBFY3NTZWNyZXQgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWVjc1wiO1xuaW1wb3J0IHtcbiAgQXBwbGljYXRpb25Qcm90b2NvbCxcbiAgTGlzdGVuZXJBY3Rpb24sXG4gIExpc3RlbmVyQ29uZGl0aW9uLFxuICBVbmF1dGhlbnRpY2F0ZWRBY3Rpb24sXG59IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZWxhc3RpY2xvYWRiYWxhbmNpbmd2MlwiO1xuaW1wb3J0IHsgRG9ja2VySW1hZ2VBc3NldCwgUGxhdGZvcm0gfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWVjci1hc3NldHNcIjtcbmltcG9ydCAqIGFzIGNvZ25pdG8gZnJvbSBcImF3cy1jZGstbGliL2F3cy1jb2duaXRvXCI7XG5pbXBvcnQgKiBhcyByb3V0ZTUzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtcm91dGU1M1wiO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZWMyXCI7XG5pbXBvcnQgKiBhcyBzc20gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zc21cIjtcbmltcG9ydCAqIGFzIHBhdGggZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IEF1dGhlbnRpY2F0ZUNvZ25pdG9BY3Rpb24gfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWVsYXN0aWNsb2FkYmFsYW5jaW5ndjItYWN0aW9uc1wiO1xuXG5pbXBvcnQgeyBSb2xlLCBTZXJ2aWNlUHJpbmNpcGFsLCBQb2xpY3lTdGF0ZW1lbnQgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWlhbVwiO1xuaW1wb3J0IHsgY3AgfSBmcm9tIFwiZnNcIjtcbmltcG9ydCB7IG1hdGNoIH0gZnJvbSBcImFzc2VydFwiO1xuaW1wb3J0ICogYXMgZG90ZW52IGZyb20gXCJkb3RlbnZcIjtcbmltcG9ydCB7IHJlYWRGaWxlU3luYyB9IGZyb20gXCJmc1wiO1xuaW1wb3J0IHsgTmFnU3VwcHJlc3Npb25zIH0gZnJvbSBcImNkay1uYWdcIjtcblxuZXhwb3J0IGludGVyZmFjZSBTdHJlYW1saXRTdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICBkb21haW5OYW1lOiBzdHJpbmc7XG4gIGFwaU5hbWU6IHN0cmluZztcbiAgYWNjZXNzbG9nZ2luZz86IGJvb2xlYW47XG4gIHJhbmRvbUhlYWRlclZhbHVlOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBTb25pY0JhY2tlbmRTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBTdHJlYW1saXRTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG4gICAgY29uc3QgZnFkbiA9IGAke3Byb3BzLmFwaU5hbWV9LiR7cHJvcHMuZG9tYWluTmFtZX1gO1xuXG4gICAgY29uc3QgaG9zdGVkWm9uZUlkID0gcm91dGU1My5Ib3N0ZWRab25lLmZyb21Mb29rdXAodGhpcywgXCJob3N0ZWQtem9uZVwiLCB7XG4gICAgICBkb21haW5OYW1lOiBwcm9wcy5kb21haW5OYW1lLFxuICAgIH0pO1xuXG4gICAgY29uc3QgY29udGFpbmVyID0gbmV3IERvY2tlckltYWdlQXNzZXQodGhpcywgXCJzb25pYy1zZXJ2ZXItaW1hZ2VcIiwge1xuICAgICAgZGlyZWN0b3J5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCBcIi4uXCIsIFwiZG9ja2VyXCIpLFxuICAgICAgcGxhdGZvcm06IFBsYXRmb3JtLkxJTlVYX0FNRDY0LFxuICAgIH0pO1xuXG4gICAgY29uc3Qgc29uaWNTZXJ2ZXJSb2xlID0gbmV3IFJvbGUodGhpcywgXCJzb25pY1NlcnZlclJvbGVcIiwge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgU2VydmljZVByaW5jaXBhbChcImVjcy10YXNrcy5hbWF6b25hd3MuY29tXCIpLFxuICAgIH0pO1xuXG4gICAgc29uaWNTZXJ2ZXJSb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGNkay5hd3NfaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICBcImJlZHJvY2s6SW52b2tlTW9kZWxcIixcbiAgICAgICAgICBcImJlZHJvY2s6SW52b2tlTW9kZWxXaXRoUmVzcG9uc2VTdHJlYW1cIixcbiAgICAgICAgICBcImJlZHJvY2s6SW52b2tlTW9kZWxXaXRoQmlkaXJlY3Rpb25hbFN0cmVhbVwiLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBcImFybjphd3M6YmVkcm9jazp1cy1lYXN0LTE6OmZvdW5kYXRpb24tbW9kZWwvYW1hem9uLm5vdmEtc29uaWMtdjE6MFwiLFxuICAgICAgICBdLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zQnlQYXRoKFxuICAgICAgdGhpcyxcbiAgICAgIFwiL1NvbmljQmFja2VuZFN0YWNrL3NvbmljU2VydmVyUm9sZS9EZWZhdWx0UG9saWN5L1Jlc291cmNlXCIsXG4gICAgICBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtSUFNNVwiLFxuICAgICAgICAgIHJlYXNvbjogXCJObyB3aWxkY2FyZFwiLFxuICAgICAgICB9LFxuICAgICAgXVxuICAgICk7XG5cbiAgICAvLyBDcmVhdGUgcGFyYW1ldGVycyBpbiBQYXJhbWV0ZXIgU3RvcmUgd2l0aCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZnJvbSAuZW52IGZpbGVcbiAgICBjb25zdCBlbnZWYXJzID0gZG90ZW52LnBhcnNlKHJlYWRGaWxlU3luYyhcIi4uL2FwaS8uZW52XCIpLnRvU3RyaW5nKFwidXRmOFwiKSk7XG4gICAgY29uc3QgcGFyYW1ldGVyczogUmVjb3JkPHN0cmluZywgc3NtLlN0cmluZ1BhcmFtZXRlcj4gPSB7fTtcblxuICAgIC8vIENyZWF0ZSBTU00gcGFyYW1ldGVycyBmb3IgZWFjaCBlbnZpcm9ubWVudCB2YXJpYWJsZVxuICAgIE9iamVjdC5lbnRyaWVzKGVudlZhcnMpLmZvckVhY2goKFtrZXksIHZhbHVlXSkgPT4ge1xuICAgICAgcGFyYW1ldGVyc1trZXldID0gbmV3IHNzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywgYEFwcEVudlZhci0ke2tleX1gLCB7XG4gICAgICAgIHBhcmFtZXRlck5hbWU6IGAvJHtwcm9wcy5hcGlOYW1lfS9lbnYvJHtrZXl9YCxcbiAgICAgICAgc3RyaW5nVmFsdWU6IHZhbHVlLFxuICAgICAgICBkZXNjcmlwdGlvbjogYEVudmlyb25tZW50IHZhcmlhYmxlICR7a2V5fSBmb3IgJHtwcm9wcy5hcGlOYW1lfWAsXG4gICAgICAgIHRpZXI6IHNzbS5QYXJhbWV0ZXJUaWVyLlNUQU5EQVJELFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCB0aGUgdGFzayByb2xlIHBlcm1pc3Npb24gdG8gcmVhZCB0aGUgcGFyYW1ldGVyc1xuICAgIHNvbmljU2VydmVyUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBQb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbXCJzc206R2V0UGFyYW1ldGVyc1wiLCBcInNzbTpHZXRQYXJhbWV0ZXJcIl0sXG4gICAgICAgIHJlc291cmNlczogT2JqZWN0LnZhbHVlcyhwYXJhbWV0ZXJzKS5tYXAoKHBhcmFtKSA9PiBwYXJhbS5wYXJhbWV0ZXJBcm4pLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgY29uc3QgYUxCU2VydmljZSA9IG5ldyBBcHBsaWNhdGlvbkxvYWRCYWxhbmNlZEZhcmdhdGVTZXJ2aWNlKHRoaXMsIFwidGdcIiwge1xuICAgICAgYXNzaWduUHVibGljSXA6IGZhbHNlLFxuICAgICAgZGVzaXJlZENvdW50OiAxLFxuICAgICAgZG9tYWluTmFtZTogZnFkbixcbiAgICAgIGRvbWFpblpvbmU6IGhvc3RlZFpvbmVJZCxcbiAgICAgIHByb3RvY29sOiBBcHBsaWNhdGlvblByb3RvY29sLkhUVFBTLFxuICAgICAgcmVkaXJlY3RIVFRQOiBmYWxzZSxcbiAgICAgIHRhc2tJbWFnZU9wdGlvbnM6IHtcbiAgICAgICAgaW1hZ2U6IENvbnRhaW5lckltYWdlLmZyb21Eb2NrZXJJbWFnZUFzc2V0KGNvbnRhaW5lciksXG4gICAgICAgIGNvbnRhaW5lclBvcnQ6IDMwMDAsXG4gICAgICAgIHRhc2tSb2xlOiBzb25pY1NlcnZlclJvbGUsXG4gICAgICAgIHNlY3JldHM6IE9iamVjdC5lbnRyaWVzKHBhcmFtZXRlcnMpLnJlZHVjZShcbiAgICAgICAgICAoYWNjLCBba2V5LCBwYXJhbV0pID0+IHtcbiAgICAgICAgICAgIGFjY1trZXldID0gRWNzU2VjcmV0LmZyb21Tc21QYXJhbWV0ZXIocGFyYW0pO1xuICAgICAgICAgICAgcmV0dXJuIGFjYztcbiAgICAgICAgICB9LFxuICAgICAgICAgIHt9IGFzIFJlY29yZDxzdHJpbmcsIEVjc1NlY3JldD5cbiAgICAgICAgKSxcbiAgICAgIH0sXG4gICAgICBjcHU6IDEwMjQsXG4gICAgICBtZW1vcnlMaW1pdE1pQjogMjA0OCxcbiAgICAgIGVuYWJsZUV4ZWN1dGVDb21tYW5kOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zQnlQYXRoKFxuICAgICAgdGhpcyxcbiAgICAgIFwiL1NvbmljQmFja2VuZFN0YWNrL3RnL1Rhc2tEZWYvRXhlY3V0aW9uUm9sZS9EZWZhdWx0UG9saWN5L1Jlc291cmNlXCIsXG4gICAgICBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtSUFNNVwiLFxuICAgICAgICAgIHJlYXNvbjogXCJUaGlzIGlzIHRoZSBkZWZhdWx0IHJvbGVcIixcbiAgICAgICAgfSxcbiAgICAgIF1cbiAgICApO1xuXG4gICAgLy9UaGlzIGNhbiBiZSBmdXJ0aGVyIHJlc3RyaWN0ZWQgdG8gYWxsb3cgZWdyZXNzIGZyb20gTEIgLT4gYSBzZWN1cml0eSBncm91cCB0aGF0IGNvbnRyb2xzIGFjY2Vzc1xuICAgIC8vRm9yIG5vdyB3ZSdyZSBhbGxvd2luZyBvdXRib3VuZCA0NDMgdG8gYW55d2hlcmUgc28gdGhhdCB0aGUgTEIgY2FuIHJlYWNoIENvZ25pdG8gdG8gdmVyaWZ5IHRva2Vuc1xuICAgIGFMQlNlcnZpY2UubG9hZEJhbGFuY2VyLmNvbm5lY3Rpb25zLmFsbG93VG9BbnlJcHY0KFxuICAgICAgZWMyLlBvcnQudGNwKDQ0MyksXG4gICAgICBcIkFsbG93IEFMQiB0byByZWFjaCBDb2duaXRvIHRvIHZlcmlmeSB0b2tlbnNcIlxuICAgICk7XG5cbiAgICBhTEJTZXJ2aWNlLmxvYWRCYWxhbmNlci5jb25uZWN0aW9ucy5hbGxvd0Zyb21BbnlJcHY0KFxuICAgICAgZWMyLlBvcnQudGNwKDQ0MyksXG4gICAgICBcIkFsbG93IGFjY2VzcyB0byB0aGUgbG9hZCBiYWxhbmNlclwiXG4gICAgKTtcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9uc0J5UGF0aChcbiAgICAgIHRoaXMsXG4gICAgICBcIi9Tb25pY0JhY2tlbmRTdGFjay90Zy9MQi9TZWN1cml0eUdyb3VwL1Jlc291cmNlXCIsXG4gICAgICBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtRUMyM1wiLFxuICAgICAgICAgIHJlYXNvbjpcbiAgICAgICAgICAgIFwiVGhpcyBpcyBhIHB1YmxpYy1mYWNpbmcgbG9hZCBiYWxhbmNlciB0aGF0IG5lZWRzIHRvIGJlIGFjY2Vzc2libGUgb24gSFRUUFMgcG9ydCA0NDNcIixcbiAgICAgICAgfSxcbiAgICAgIF1cbiAgICApO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKGFMQlNlcnZpY2UubG9hZEJhbGFuY2VyLCBbXG4gICAgICB7XG4gICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1FTEIyXCIsXG4gICAgICAgIHJlYXNvbjogXCJUaGlzIGlzIGEgbG9hZCBiYWxhbmNlciBmb3IgYSBkZW1vLlwiLFxuICAgICAgfSxcbiAgICBdKTtcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhhTEJTZXJ2aWNlLmNsdXN0ZXIudnBjLCBbXG4gICAgICB7IGlkOiBcIkF3c1NvbHV0aW9ucy1WUEM3XCIsIHJlYXNvbjogXCJUaGlzIGlzIGEgZGVtbyBWUENcIiB9LFxuICAgIF0pO1xuXG4gICAgYUxCU2VydmljZS50YXJnZXRHcm91cC5jb25maWd1cmVIZWFsdGhDaGVjayh7XG4gICAgICBwYXRoOiBcIi9oZWFsdGhcIixcbiAgICAgIGhlYWx0aHlIdHRwQ29kZXM6IFwiMjAwXCIsXG4gICAgfSk7XG5cbiAgICAvLyBFbmFibGUgQ29udGFpbmVyIEluc2lnaHRzIGZvciB0aGUgY2x1c3RlclxuICAgIGNvbnN0IGNmbkNsdXN0ZXIgPSBhTEJTZXJ2aWNlLmNsdXN0ZXIubm9kZVxuICAgICAgLmRlZmF1bHRDaGlsZCBhcyBjZGsuYXdzX2Vjcy5DZm5DbHVzdGVyO1xuICAgIGNmbkNsdXN0ZXIuYWRkUHJvcGVydHlPdmVycmlkZShcIkNsdXN0ZXJTZXR0aW5nc1wiLCBbXG4gICAgICB7XG4gICAgICAgIE5hbWU6IFwiY29udGFpbmVySW5zaWdodHNcIixcbiAgICAgICAgVmFsdWU6IFwiZW5hYmxlZFwiLFxuICAgICAgfSxcbiAgICBdKTtcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhhTEJTZXJ2aWNlLmNsdXN0ZXIsIFtcbiAgICAgIHtcbiAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLUVDUzRcIixcbiAgICAgICAgcmVhc29uOiBcIlRoaXMgaXMgYSBkZW1vIGNsdXN0ZXIuXCIsXG4gICAgICB9LFxuICAgIF0pO1xuXG4gICAgLy9Db2duaXRvIHJlc291cmNlc1xuICAgIC8vVE9ETzogQWxsb3cgdXNlcnMgdG8gcHJvdmlkZSB0aGVpciBvd24gdXNlciBwb29sXG4gICAgY29uc3QgdXNlclBvb2wgPSBuZXcgY29nbml0by5Vc2VyUG9vbCh0aGlzLCBcIlNvbmljVXNlclBvb2xcIiwge1xuICAgICAgZmVhdHVyZVBsYW46IGNvZ25pdG8uRmVhdHVyZVBsYW4uRVNTRU5USUFMUyxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBwYXNzd29yZFBvbGljeToge1xuICAgICAgICBtaW5MZW5ndGg6IDgsXG4gICAgICAgIHJlcXVpcmVEaWdpdHM6IHRydWUsXG4gICAgICAgIHJlcXVpcmVMb3dlcmNhc2U6IHRydWUsXG4gICAgICAgIHJlcXVpcmVTeW1ib2xzOiB0cnVlLFxuICAgICAgICByZXF1aXJlVXBwZXJjYXNlOiB0cnVlLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyh1c2VyUG9vbCwgW1xuICAgICAge1xuICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtQ09HMlwiLFxuICAgICAgICByZWFzb246IFwiVGhpcyBpcyBhIGRlbW8gYXBwbGljYXRpb24uXCIsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtQ09HM1wiLFxuICAgICAgICByZWFzb246IFwiVGhpcyBpcyBhIGRlbW8gYXBwbGljYXRpb24uXCIsXG4gICAgICB9LFxuICAgIF0pO1xuXG4gICAgY29uc3QgdXNlclBvb2xDbGllbnQgPSBuZXcgY29nbml0by5Vc2VyUG9vbENsaWVudCh0aGlzLCBcIkNsaWVudFwiLCB7XG4gICAgICB1c2VyUG9vbCxcbiAgICAgIC8vIFJlcXVpcmVkIG1pbmltYWwgY29uZmlndXJhdGlvbiBmb3IgdXNlIHdpdGggYW4gRUxCXG4gICAgICBnZW5lcmF0ZVNlY3JldDogdHJ1ZSxcbiAgICAgIGF1dGhGbG93czoge1xuICAgICAgICB1c2VyUGFzc3dvcmQ6IHRydWUsXG4gICAgICB9LFxuICAgICAgb0F1dGg6IHtcbiAgICAgICAgZmxvd3M6IHtcbiAgICAgICAgICBhdXRob3JpemF0aW9uQ29kZUdyYW50OiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICBzY29wZXM6IFtjb2duaXRvLk9BdXRoU2NvcGUuRU1BSUxdLFxuICAgICAgICBjYWxsYmFja1VybHM6IFtgaHR0cHM6Ly8ke2ZxZG59L29hdXRoMi9pZHByZXNwb25zZWBdLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGNmbkNsaWVudCA9IHVzZXJQb29sQ2xpZW50Lm5vZGVcbiAgICAgIC5kZWZhdWx0Q2hpbGQgYXMgY29nbml0by5DZm5Vc2VyUG9vbENsaWVudDtcbiAgICBjZm5DbGllbnQuYWRkUHJvcGVydHlPdmVycmlkZShcIlJlZnJlc2hUb2tlblZhbGlkaXR5XCIsIDcpO1xuICAgIGNmbkNsaWVudC5hZGRQcm9wZXJ0eU92ZXJyaWRlKFwiU3VwcG9ydGVkSWRlbnRpdHlQcm92aWRlcnNcIiwgW1wiQ09HTklUT1wiXSk7XG5cbiAgICBjb25zdCB1c2VyUG9vbERvbWFpbiA9IG5ldyBjb2duaXRvLlVzZXJQb29sRG9tYWluKHRoaXMsIFwiRG9tYWluXCIsIHtcbiAgICAgIHVzZXJQb29sLFxuICAgICAgY29nbml0b0RvbWFpbjoge1xuICAgICAgICBkb21haW5QcmVmaXg6IGAke3Byb3BzLmFwaU5hbWV9LXVzZXJzYCxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvL0NvZ25pdG8gcmVzb3VyY2VzXG4gICAgLy9BbGwgcmVxdWVzdHMgdG8gYmUgYXV0aGVudGljYXRlZCBieSBDb2duaXRvXG4gICAgYUxCU2VydmljZS5saXN0ZW5lci5hZGRBY3Rpb24oXCJtYW5pZmVzdC1qc29uXCIsIHtcbiAgICAgIGFjdGlvbjogTGlzdGVuZXJBY3Rpb24uZm9yd2FyZChbYUxCU2VydmljZS50YXJnZXRHcm91cF0pLFxuICAgICAgY29uZGl0aW9uczogW1xuICAgICAgICBMaXN0ZW5lckNvbmRpdGlvbi5wYXRoUGF0dGVybnMoW1xuICAgICAgICAgIFwiL21hbmlmZXN0Lmpzb25cIixcbiAgICAgICAgICBcIi9pY29ucy8qXCIsXG4gICAgICAgICAgXCIvb2F1dGgyLypcIixcbiAgICAgICAgXSksXG4gICAgICBdLFxuICAgICAgcHJpb3JpdHk6IDEsXG4gICAgfSk7XG4gICAgYUxCU2VydmljZS5saXN0ZW5lci5hZGRBY3Rpb24oXCJjb2duaXRvLXJ1bGVcIiwge1xuICAgICAgYWN0aW9uOiBuZXcgQXV0aGVudGljYXRlQ29nbml0b0FjdGlvbih7XG4gICAgICAgIHVzZXJQb29sLFxuICAgICAgICB1c2VyUG9vbENsaWVudCxcbiAgICAgICAgdXNlclBvb2xEb21haW4sXG4gICAgICAgIHNlc3Npb25UaW1lb3V0OiBjZGsuRHVyYXRpb24uZGF5cyg3KSxcbiAgICAgICAgbmV4dDogTGlzdGVuZXJBY3Rpb24uZm9yd2FyZChbYUxCU2VydmljZS50YXJnZXRHcm91cF0pLFxuICAgICAgICBvblVuYXV0aGVudGljYXRlZFJlcXVlc3Q6IFVuYXV0aGVudGljYXRlZEFjdGlvbi5BVVRIRU5USUNBVEUsXG4gICAgICB9KSxcbiAgICB9KTtcbiAgfVxufVxuIl19