import { Consumer } from "./consumer"

export const start = () => {
    const consumer = Consumer.create({
        queueUrl: "https://sqs.us-east-1.amazonaws.com/880892332156/_devstack_jirijanecek_PaymentService_Queue.fifo",
        handleMessage: (msg) =>
            new Promise((res, rej) =>
                setTimeout(() => {
                    console.log(`processed ${msg.Body}`)
                    res()
                }, 3000),
            ),
        visibilityTimeout: 10,
        batchSize: 100,
    })

    consumer.start()
}

start()
