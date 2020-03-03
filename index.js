#!/usr/bin/env node

'use strict';

const rimraf = require('rimraf');
const child_process = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const argv = require('yargs')
	.usage('Usage: $0 [options]\n\nDestroys an AWS Terraform deployment from an S3 state file')

	.help('help')
    .alias('help', 'h')
    
    .option('profile', {
        describe: 'AWS profile to use from your credential file',
        nargs: 1
    })

    .option('region', {
        describe: 'AWS region to use',
        nargs: 1,
        default: 'us-east-1'
    })

    .option('bucket', {
        describe: 'Name of S3 bucket containing Terraform state file',
        nargs: 1,
        demandOption: true
    })

    .option('key', {
        describe: 'Key of Terraform state file in S3 bucket',
        type: 'array'
    })

    .option('pattern', {
        describe: 'Regex for keys of Terraform state files in S3 bucket',
        type: 'array',
        coerce: (input) => input.map(p => new RegExp(p))
    })

    .option('delete-state', {
        describe: 'Delete Terraform state file from S3 when complete',
        type: 'boolean',
        default: false
    })

    .option('auto-approve', {
        describe: 'Do not ask for confirmation',
        type: 'boolean',
        default: false
    })

    .option('dry-run', {
        describe: 'Do not destroy anything, just show what would be done',
        type: 'boolean',
        default: false
    })

    .check(argv => {
        if (!argv.key && !argv.pattern) {
            throw new Error('Must specify either --key or --pattern');
        }
        return true;
    })

	.strict()
    .argv;

// apply profile to all subsequent commands - must do this before loading AWS SDK
if (argv.profile) {
    process.env.AWS_PROFILE = argv.profile;
}

const AWS = require('aws-sdk');
const s3 = new AWS.S3({region: argv.region});

function matchPatterns(key) {
    for (const pattern of argv.pattern) {
        if (pattern.test(key)) {
            return true;
        }
    }
    return false;
}

async function deleteState(key) {
    await s3.deleteObject({
        Bucket: argv.bucket,
        Key: key
    }).promise();
}

function exec(command) {
    child_process.execSync(command, {stdio: 'inherit'});
}

async function main() {
    const keys = argv.key || [];
    if (argv.pattern) {
        let continuationToken = undefined;
        do {
            const result = await s3.listObjectsV2({
                Bucket: argv.bucket,
                ContinuationToken: continuationToken
            }).promise();
            result.Contents.map(obj => obj.Key).filter(matchPatterns).forEach(k => keys.push(k));
            continuationToken = result.ContinuationToken;
        } while (continuationToken);
    }

    for (const key of keys) {
        if (argv['dry-run']) {
            console.log(`\nWould destroy resources for ${key}...\n`);
        } else {
            console.log(`\nDestroying resources for ${key}...\n`);
        }

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terraform-s3-nuke-'));
        process.chdir(tempDir);

        fs.writeFileSync('main.tf.json', JSON.stringify({
            provider: {
                aws: {
                    region: argv.region
                }
            },
            terraform: {
                backend: {
                    s3: {
                        region: argv.region,
                        bucket: argv.bucket,
                        key
                    }
                } 
            }
        }));

        try {
            exec('terraform init');

            if (argv['dry-run']) {
                exec('terraform plan -destroy');
            } else {
                if (argv['auto-approve']) {
                    exec('terraform destroy -auto-approve');
                } else {
                    exec('terraform destroy');
                }
            }

            if (argv['delete-state']) {
                if (argv['dry-run']) {
                    console.log(`\nWould delete state file ${key}\n`);
                } else {
                    await deleteState(key);
                    console.log(`\nDeleted state file ${key}\n`);
                }
            }
        } finally {
            rimraf.sync(tempDir);
        }
    }
}

main().catch(console.error);
