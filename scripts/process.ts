import { Consumer } from "../src/consumer"
import AWS = require("aws-sdk")

const random = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1) + min)
}

export const run = () => {
    const queueUrl = "https://sqs.us-east-1.amazonaws.com/880892332156/_testing_sqs_consumer.fifo"
    const processingTimeFrom = 0.5
    const processingTimeTo = 2
    const batchSize = 100

    const consumer = Consumer.create({
        queueUrl: queueUrl,
        handleMessage: (msg) =>
            new Promise((res) => {
                console.log(`Start ${msg.Body}`)
                setTimeout(() => {
                    console.log(`End ${msg.Body}`)
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

    consumer.start()
}

run()
