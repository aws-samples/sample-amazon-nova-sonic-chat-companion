#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { SonicBackendStack } from "../lib/backend-stack";
import * as crypto from "crypto";
import { AwsSolutionsChecks } from "cdk-nag";

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

console.log(env);
const app = new cdk.App();

cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
new SonicBackendStack(app, "SonicBackendStack", {
  // randomHeaderValue: crypto.randomBytes(48).toString("base64"),
  env: env,
  //DomainName root - this is a route53 hosted domain that is in the same account as this stack
  domainName: process.env.DOMAIN_NAME!,
  //The API name. The app will be hosted at apiName.domainName
  apiName: process.env.API_NAME!,
});
