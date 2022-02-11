import * as AWS from "aws-sdk"

const splitEvery = (n, list) => {
    const result = []
    let idx = 0
    while (idx < list.length) {
        result.push(list.slice(idx, (idx += n)))
    }
    return result
}

const range = (from, to) => {
    const result = []
    let n = from
    while (n < to) {
        result.push(n)
        n += 1
    }
    return result
}

const run = async () => {
    const queueUrl = "https://sqs.us-east-1.amazonaws.com/880892332156/_devstack_jirijanecek_PaymentService_Queue.fifo"
    const numberOfMessages = 1000
    const numberOfGroups = 10

    const sqs = new AWS.SQS({ region: "us-east-1" })
    const batch = range(0, numberOfMessages)
    const batches = splitEvery(10, batch)

    for (const batch of batches) {
        await sqs
            .sendMessageBatch({
                QueueUrl: queueUrl,
                Entries: batch.map((e) => {
                    const id = `${e}`
                    const group = `${e % numberOfGroups}`
                    return {
                        Id: id,
                        MessageBody: JSON.stringify({ id: id, group: group }),
                        MessageDeduplicationId: id,
                        MessageGroupId: group,
                    }
                }),
            })
            .promise()
    }

    console.log("Done.")
    process.exit(0)
}

run()
