#!/bin/sh

export AWS_PAGER=""

aws sqs create-queue \
  --queue-name "queue.fifo" \
  --attributes "{\"FifoQueue\":\"True\"}" \
  --region "us-east-1" \
  --endpoint "http://localhost:4566"
