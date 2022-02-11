import { Consumer } from "../src/consumer"
import AWS = require("aws-sdk")

const random = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1) + min)
}

export const run = () => {
    const queueUrl = "https://sqs.us-east-1.amazonaws.com/880892332156/_testing_sqs_consumer.fifo"
    const processingTimeFrom = 0.5
    const processingTimeTo = 4
    const batchSize = 100

    const consumer = Consumer.create({
        queueUrl: queueUrl,
        handleMessage: (msg) =>
            new Promise((res) => {
                setTimeout(() => {
                    res()
                }, random(processingTimeFrom, processingTimeTo) * 1000)
            }),
        batchSize: batchSize,
        sqs: new AWS.SQS({
            region: "us-east-1",
            // credentials: {
            //     accessKeyId: "foobar",
            //     secretAccessKey: "foobar",
            // },
        }),
    })

    consumer.on("message_processed", (msg: AWS.SQS.Message, data: any) => {
        console.log(JSON.stringify({ ...JSON.parse(msg.Body), ...data }))
    })

    consumer.start()
}

run()
