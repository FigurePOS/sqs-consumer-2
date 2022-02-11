#!/bin/bash

set -o pipefail

echo "Starting localstack"

docker-compose up -d aws

echo "Waiting for localstack start..."

./wait.sh cmd 60 "curl \"http://localhost:4566/sqs/?Action=ListQueues\" >/dev/null 2>&1"

echo "Initializing localstack..."

./localstack/init.sh

echo "Localstack ready."
