'use strict';

const sinon = require('sinon');
const assert = require('chai').assert;
const proxyquire = require('proxyquire').noPreserveCache().noCallThru();

const TEMP_DIR = 'abcxyz';

function createS3Stub({listResult, deleteResult} = {}) {
    const listObjectsV2Promise = sinon.stub();
    const deleteObjectPromise = sinon.stub();

    if (listResult instanceof Error) {
        listObjectsV2Promise.rejects(listResult);
    } else if (Array.isArray(listResult)) {
        for (let i = 0; i < listResult.length; i++) {
            listObjectsV2Promise.onCall(i).resolves(listResult[i]);
        }
    } else {
        listObjectsV2Promise.resolves(listResult);
    }

    if (deleteResult instanceof Error) {
        deleteObjectPromise.rejects(deleteResult);
    } else {
        deleteObjectPromise.resolves(deleteResult);
    }

    return {
        listObjectsV2: sinon.stub().returns({
            promise: listObjectsV2Promise
        }),
        deleteObject: sinon.stub().returns({
            promise: deleteObjectPromise
        })
    };
}

function createStubs(argv, s3Stub) {
    return {
        process: {
            argv,
            exit: sinon.stub().throws(new Error('Process exited')),
            chdir: sinon.stub()
        },
        'aws-sdk': {
            S3: sinon.stub().returns(s3Stub)
        },
        child_process: {
            execSync: sinon.stub()
        },
        fs: {
            mkdtempSync: sinon.stub().returns(TEMP_DIR),
            writeFileSync: sinon.stub()
        },
        rimraf: {
            sync: sinon.stub()
        }
    };
}

function verifyKeyProcessed({stubs, s3Stub, region, bucket, key, mainCommand, deleteState = false, iteration = 0}) {

    assert.isTrue(stubs.fs.mkdtempSync.getCall(iteration).calledWith())
    assert.isTrue(stubs.process.chdir.getCall(iteration).calledWith(TEMP_DIR));

    const tfJson = JSON.parse(stubs.fs.writeFileSync.getCall(iteration).args[1]);
    assert.deepEqual(tfJson, {
        provider: {
            aws: {
                region
            }
        },
        terraform: {
            backend: {
                s3: {
                    region,
                    bucket,
                    key
                }
            }
        }
    });

    assert.equal(stubs.child_process.execSync.getCall(iteration * 2).args[0], 'terraform init');
    assert.equal(stubs.child_process.execSync.getCall(iteration * 2 + 1).args[0], mainCommand);

    if (deleteState) {
        const deleteParams = s3Stub.deleteObject.getCall(iteration).args[0];
        assert.deepEqual(deleteParams, {
            Bucket: bucket,
		    Key: key
        });
    } else {
        assert.isTrue(s3Stub.deleteObject.notCalled);
    }

    assert.isTrue(stubs.rimraf.sync.getCall(iteration).calledWith(TEMP_DIR));
}

describe('terraform-s3-nuke', () => {

    beforeEach(() => {
        this.savedLog = console.log;
        this.savedError = console.error;
        console.log = () => {};
        console.error = () => {};
    });

    afterEach(() => {
        console.log = this.savedLog;
        console.error = this.savedError;
    });

    it('fails if --bucket is missing', async () => {
        const s3Stub = createS3Stub();
        const stubs = createStubs(['node', 'index.js', '--key', 'bar'], s3Stub);
        try {
            await proxyquire('../index', stubs);
            assert.fail('Did not throw')
        } catch (err) {
            assert.equal(err.message, 'Process exited');
        }
    });

    it('fails if --key and --pattern are missing', async () => {
        const stubs = createStubs(['node', 'index.js', '--bucket', 'foo']);
        try {
            await proxyquire('../index', stubs);
            assert.fail('Did not throw')
        } catch (err) {
            assert.equal(err.message, 'Process exited');
        }
    });

    it('performs dry run of with one key', async () => {
        const s3Stub = createS3Stub();
        const stubs = createStubs(['node', 'index.js', '--bucket', 'foo', '--key', 'bar', '--dry-run'], s3Stub);
        await proxyquire('../index', stubs);

        verifyKeyProcessed({
            stubs,
            s3Stub,
            region: 'us-east-1',
            bucket: 'foo',
            key: 'bar',
            mainCommand: 'terraform plan -destroy'
        });
    });

    it('performs dry run of with one key and does not delete state', async () => {
        const s3Stub = createS3Stub();
        const stubs = createStubs(['node', 'index.js', '--bucket', 'foo', '--key', 'bar', '--dry-run', '--delete-state'], s3Stub);
        await proxyquire('../index', stubs);

        verifyKeyProcessed({
            stubs,
            s3Stub,
            region: 'us-east-1',
            bucket: 'foo',
            key: 'bar',
            mainCommand: 'terraform plan -destroy'
        });
    });

    it('performs destroy of with one key', async () => {
        const s3Stub = createS3Stub();
        const stubs = createStubs(['node', 'index.js', '--bucket', 'foo', '--key', 'bar'], s3Stub);
        await proxyquire('../index', stubs);

        verifyKeyProcessed({
            stubs,
            s3Stub,
            region: 'us-east-1',
            bucket: 'foo',
            key: 'bar',
            mainCommand: 'terraform destroy'
        });
    });

    it('performs destroy of with one key and auto approves', async () => {
        const s3Stub = createS3Stub();
        const stubs = createStubs(['node', 'index.js', '--bucket', 'foo', '--key', 'bar', '--auto-approve'], s3Stub);
        await proxyquire('../index', stubs);

        verifyKeyProcessed({
            stubs,
            s3Stub,
            region: 'us-east-1',
            bucket: 'foo',
            key: 'bar',
            mainCommand: 'terraform destroy -auto-approve'
        });
    });

    it('performs destroy of with one key and deletes state', async () => {
        const s3Stub = createS3Stub();
        const stubs = createStubs(['node', 'index.js', '--bucket', 'foo', '--key', 'bar',  '--delete-state'], s3Stub);
        await proxyquire('../index', stubs);

        verifyKeyProcessed({
            stubs,
            s3Stub,
            region: 'us-east-1',
            bucket: 'foo',
            key: 'bar',
            mainCommand: 'terraform destroy',
            deleteState: true
        });
    });

    it('performs destroy of with multiple keys', async () => {
        const s3Stub = createS3Stub();
        const stubs = createStubs(['node', 'index.js', '--bucket', 'foo', '--key', 'bar', '--key', 'baz'], s3Stub);
        await proxyquire('../index', stubs);

        verifyKeyProcessed({
            stubs,
            s3Stub,
            region: 'us-east-1',
            bucket: 'foo',
            key: 'bar',
            mainCommand: 'terraform destroy',
            iteration: 0
        });

        verifyKeyProcessed({
            stubs,
            s3Stub,
            region: 'us-east-1',
            bucket: 'foo',
            key: 'baz',
            mainCommand: 'terraform destroy',
            iteration: 1
        });
    });

    it('performs no destroy of with one pattern, no match', async () => {
        const s3Stub = createS3Stub({
            listResult: {
                IsTruncated: false,
                KeyCount: 3,
                Contents: [
                    {Key: 'alpha'},
                    {Key: 'bravo'},
                    {Key: 'zulu'}
                ]
            }
        });
        const stubs = createStubs(['node', 'index.js', '--bucket', 'foo', '--pattern', 'x.*'], s3Stub);
        await proxyquire('../index', stubs);

        assert.isTrue(stubs.fs.mkdtempSync.notCalled)
        assert.isTrue(stubs.process.chdir.notCalled);
        assert.isTrue(stubs.fs.writeFileSync.notCalled);
        assert.isTrue(stubs.child_process.execSync.notCalled);
        assert.isTrue(stubs.child_process.execSync.notCalled);
        assert.isTrue(s3Stub.deleteObject.notCalled);
        assert.isTrue(stubs.rimraf.sync.notCalled);
    });

    it('performs destroy of with one pattern, one match', async () => {
        const s3Stub = createS3Stub({
            listResult: {
                IsTruncated: false,
                KeyCount: 2,
                Contents: [
                    {Key: 'alpha'},
                    {Key: 'bravo'},
                    {Key: 'zulu'}
                ]
            }
        });
        const stubs = createStubs(['node', 'index.js', '--bucket', 'foo', '--pattern', 'a.*'], s3Stub);
        await proxyquire('../index', stubs);

        verifyKeyProcessed({
            stubs,
            s3Stub,
            region: 'us-east-1',
            bucket: 'foo',
            key: 'alpha',
            mainCommand: 'terraform destroy'
        });
    });

    it('performs destroy of with one pattern, multiple matches', async () => {
        const s3Stub = createS3Stub({
            listResult: {
                IsTruncated: false,
                KeyCount: 3,
                Contents: [
                    {Key: 'alpha'},
                    {Key: 'bravo'},
                    {Key: 'zulu'}
                ]
            }
        });
        const stubs = createStubs(['node', 'index.js', '--bucket', 'foo', '--pattern', '.*a.*'], s3Stub);
        await proxyquire('../index', stubs);

        verifyKeyProcessed({
            stubs,
            s3Stub,
            region: 'us-east-1',
            bucket: 'foo',
            key: 'alpha',
            mainCommand: 'terraform destroy',
            iteration: 0
        });

        verifyKeyProcessed({
            stubs,
            s3Stub,
            region: 'us-east-1',
            bucket: 'foo',
            key: 'bravo',
            mainCommand: 'terraform destroy',
            iteration: 1
        });
    });

    it('performs destroy of with multiple patterns', async () => {
        const s3Stub = createS3Stub({
            listResult: {
                IsTruncated: false,
                KeyCount: 3,
                Contents: [
                    {Key: 'alpha'},
                    {Key: 'bravo'},
                    {Key: 'zulu'}
                ]
            }
        });
        const stubs = createStubs(['node', 'index.js', '--bucket', 'foo', '--pattern', 'a.*', '--pattern', 'b.*'], s3Stub);
        await proxyquire('../index', stubs);

        verifyKeyProcessed({
            stubs,
            s3Stub,
            region: 'us-east-1',
            bucket: 'foo',
            key: 'alpha',
            mainCommand: 'terraform destroy',
            iteration: 0
        });

        verifyKeyProcessed({
            stubs,
            s3Stub,
            region: 'us-east-1',
            bucket: 'foo',
            key: 'bravo',
            mainCommand: 'terraform destroy',
            iteration: 1
        });
    });

    it('performs destroy of with multiple listObjects pages', async () => {
        const s3Stub = createS3Stub({
            listResult: [
                {
                    IsTruncated: true,
                    NextContinuationToken: 'abc',
                    KeyCount: 1,
                    Contents: [
                        {Key: 'alpha'}
                    ]
                },
                {
                    IsTruncated: true,
                    NextContinuationToken: 'xyz',
                    KeyCount: 1,
                    Contents: [
                        {Key: 'bravo'}
                    ]
                },
                {
                    IsTruncated: false,
                    KeyCount: 1,
                    Contents: [
                        {Key: 'zulu'}
                    ]
                }
            ]
        });
        const stubs = createStubs(['node', 'index.js', '--bucket', 'foo', '--pattern', '.*a.*'], s3Stub);
        await proxyquire('../index', stubs);

        verifyKeyProcessed({
            stubs,
            s3Stub,
            region: 'us-east-1',
            bucket: 'foo',
            key: 'alpha',
            mainCommand: 'terraform destroy',
            iteration: 0
        });

        verifyKeyProcessed({
            stubs,
            s3Stub,
            region: 'us-east-1',
            bucket: 'foo',
            key: 'bravo',
            mainCommand: 'terraform destroy',
            iteration: 1
        });
    });

    it('fails if lisObjects rejects', async () => {
        const s3Stub = createS3Stub({
            listResult: new Error('foobar')
        });
        const stubs = createStubs(['node', 'index.js', '--bucket', 'foo', '--pattern', 'x.*'], s3Stub);
        await proxyquire('../index', stubs);

        assert.equal(stubs.process.exitCode, 1);
    });

    it('fails if mkdtemp throws', async () => {
        const s3Stub = createS3Stub();
        const stubs = createStubs(['node', 'index.js', '--bucket', 'foo', '--key', 'bar'], s3Stub);
        stubs.fs.mkdtempSync.throws(new Error('foobar'));
        await proxyquire('../index', stubs);

        assert.equal(stubs.process.exitCode, 1);
    });

    it('fails if chdir throws', async () => {
        const s3Stub = createS3Stub();
        const stubs = createStubs(['node', 'index.js', '--bucket', 'foo', '--key', 'bar'], s3Stub);
        stubs.process.chdir.throws(new Error('foobar'));
        await proxyquire('../index', stubs);

        assert.equal(stubs.process.exitCode, 1);
        assert.isTrue(stubs.rimraf.sync.calledWith(TEMP_DIR));
    });

    it('fails if writeFileSync throws', async () => {
        const s3Stub = createS3Stub();
        const stubs = createStubs(['node', 'index.js', '--bucket', 'foo', '--key', 'bar'], s3Stub);
        stubs.fs.writeFileSync.throws(new Error('foobar'));
        await proxyquire('../index', stubs);

        assert.equal(stubs.process.exitCode, 1);
        assert.isTrue(stubs.rimraf.sync.calledWith(TEMP_DIR));
    });

    it('fails if terraform init throws', async () => {
        const s3Stub = createS3Stub();
        const stubs = createStubs(['node', 'index.js', '--bucket', 'foo', '--key', 'bar'], s3Stub);
        stubs.child_process.execSync.onFirstCall().throws(new Error('foobar'));
        await proxyquire('../index', stubs);

        assert.equal(stubs.process.exitCode, 1);
        assert.isTrue(stubs.rimraf.sync.calledWith(TEMP_DIR));
    });

    it('fails if terraform destroy throws', async () => {
        const s3Stub = createS3Stub();
        const stubs = createStubs(['node', 'index.js', '--bucket', 'foo', '--key', 'bar'], s3Stub);
        stubs.child_process.execSync.onSecondCall().throws(new Error('foobar'));
        await proxyquire('../index', stubs);

        assert.equal(stubs.process.exitCode, 1);
        assert.isTrue(stubs.rimraf.sync.calledWith(TEMP_DIR));
    });

    it('fails if terraform destroy throws', async () => {
        const s3Stub = createS3Stub({
            deleteResult: new Error('foobar')
        });
        const stubs = createStubs(['node', 'index.js', '--bucket', 'foo', '--key', 'bar', '--delete-state'], s3Stub);
        await proxyquire('../index', stubs);

        assert.equal(stubs.process.exitCode, 1);
        assert.isTrue(stubs.rimraf.sync.calledWith(TEMP_DIR));
    });

    it('fails if rimraf.sync throws', async () => {
        const s3Stub = createS3Stub();
        const stubs = createStubs(['node', 'index.js', '--bucket', 'foo', '--key', 'bar'], s3Stub);
        stubs.rimraf.sync.throws(new Error('foobar'));
        await proxyquire('../index', stubs);

        assert.equal(stubs.process.exitCode, 1);
    });
});
