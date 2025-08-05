import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
export interface StreamlitStackProps extends cdk.StackProps {
    domainName: string;
    apiName: string;
    accesslogging?: boolean;
    randomHeaderValue: string;
}
export declare class SonicBackendStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: StreamlitStackProps);
}
