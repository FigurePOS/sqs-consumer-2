import { Consumer } from "../src/consumer"
import AWS = require("aws-sdk")

const random = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1) + min)
}

export const run = () => {
    const queueUrl = "https://sqs.us-east-1.amazonaws.com/880892332156/_testing_sqs_consumer.fifo"
    const processingTimeFrom = 0.2
    const processingTimeTo = 2
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

    const result = []
    const dict = new Map<string, number>()

    consumer.on("message_processed", (msg: AWS.SQS.Message, data: any) => {
        console.log("message processed", msg.Body)
        result.push({ ...JSON.parse(msg.Body), ...data })
    })

    consumer.on("empty", () => {
        console.log("received empty")
        result.forEach((d) => {
            const group = d.group
            const id = parseInt(d.id)
            const lastProcessed = dict[group] ?? -1
            if (id <= lastProcessed) {
                console.error("error", JSON.stringify(dict), JSON.stringify(d))
                throw new Error()
            }
            dict[group] = id
        })

        console.log("success")
        console.log(dict)

        consumer.stop()
    })

    consumer.start()
}

run()
