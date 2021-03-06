#!/bin/bash
trap cleanup SIGINT SIGTERM

export AWS_DEFAULT_REGION=us-east-1

AWS_ACCOUNT_ID=880892332156

function cleanup() {
    exit
}

temp_role=$(aws sts assume-role --role-arn "arn:aws:iam::$AWS_ACCOUNT_ID:role/Developer" --role-session-name "cli-session")
export AWS_ACCESS_KEY_ID=$(echo $temp_role | jq .Credentials.AccessKeyId | xargs)
export AWS_SECRET_ACCESS_KEY=$(echo $temp_role | jq .Credentials.SecretAccessKey | xargs)
export AWS_SESSION_TOKEN=$(echo $temp_role | jq .Credentials.SessionToken | xargs)

echo "Creating SQS queue..."
create_queue_result=$(aws sqs create-queue \
  --attributes FifoQueue=true \
  --queue-name "_testing_sqs_consumer.fifo")
export devstack_queue_url=$(echo $create_queue_result | jq .QueueUrl | xargs)
echo "Message queue URL: $devstack_queue_url"

node -r ts-node/register "scripts/$1.ts"
