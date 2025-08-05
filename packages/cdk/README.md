# Secure websocket container application hosting

This stack deploys a docker container on Fargate behind an ALB with Cognito Authentication. To customize the application application, modify the Dockerfile in `./docker` folder. You cna then deploy via `cdk deploy`.
For applications not needing to expose a websocket API, consider using (AWS App Runner)[https://aws.amazon.com/apprunner/].

# Pre-requisites

You will need to prepare the following to deploy your service and provide these as parameters

1. An API name (e.g. sonic-chat)
1. A domain hosted in Route53 (e.g. example.com) in the account that you're deploying this in.

# Usage

NOTE: To deploy tools that use some env vars for holding API KEYs, define the env vars in `packages/api/.env` file. This will be used for both local development and will be added to the task.

```
cd packages/cdk
pnpm install
BUILDX_NO_DEFAULT_ATTESTATIONS=1 DOMAIN_NAME=<example.com> API_NAME=sonic npx cdk deploy
```

> NOTE: BUILDX_NO_DEFAULT_ATTESTATIONS=1 is required with Docker Desktop as documented in https://github.com/aws/aws-cdk/issues/31548
