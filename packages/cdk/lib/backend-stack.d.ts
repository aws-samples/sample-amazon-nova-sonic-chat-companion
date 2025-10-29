import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
export interface StackProps extends cdk.StackProps {
    domainName: string;
    apiName: string;
    accessLogging?: boolean;
}
export declare class SonicBackendStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: StackProps);
}
