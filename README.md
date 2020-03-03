# terraform-s3-nuke

Destroys a set of AWS resources deployed via Terraform using one or more state files stored in an S3 bucket (see the Terraform S3 backend [documentation](https://www.terraform.io/docs/backends/types/s3.html) for more details). None of the original Terraform files used to the deploy the resources are required. This tool makes it trivial to nuke an old deployment and is the Terraform equivalent to clicking the delete stack button in CloudFormation.

## Prerequisites

* Terraform must be installed and in your path.
* Credentials for the target AWS account with permission to destroy resources, list objects in an S3 bucket, and delete objects in an S3 bucket.

## Installation

```
npm install -g terraform-s3-nuke
```

## Usage

```
Usage: terraform-s3-nuke [options]

Destroys an AWS Terraform deployment from an S3 state file

Options:
  --version       Show version number                                  [boolean]
  --help, -h      Show help                                            [boolean]
  --profile       AWS profile to use from your credential file
  --region        AWS region to use                       [default: "us-east-1"]
  --bucket        Name of S3 bucket containing Terraform state file   [required]
  --key           Key of Terraform state file in S3 bucket               [array]
  --pattern       Regex for keys of Terraform state files in S3 bucket   [array]
  --delete-state  Delete Terraform state file from S3 when complete
                                                      [boolean] [default: false]
  --auto-approve  Do not ask for confirmation         [boolean] [default: false]
  --dry-run       Do not destroy anything, just show what would be done
                                                      [boolean] [default: false]
```

You must specify the `--bucket` flag and either the `--key` or `--pattern` flag. You may specify multiple `--key` or `--pattern` flags or a mix of both.