import "dotenv/config";
import { Consumer } from "sqs-consumer";
import path from "path";
import {
  downloadFromS3,
  transcodeAndUploadHLS,
  deleteFromS3,
} from "./utils.js";
import { fileURLToPath } from "url";
import fs from "fs";
import { db } from "./db.js";
import { videos, videoTranscodings } from "./schema/video.schema.js";
import { eq, like } from "drizzle-orm";

const queueUrl = process.env.AWS_QUEUE_URL;
const region = process.env.AWS_SQS_REGION;

const rawBucket = process.env.AWS_S3_RAW_BUCKET;
const rawRegion = process.env.AWS_S3_RAW_REGION;

const handleMessage = async (message) => {
  try {
    console.log("Received message:", message.Body);
    const messageBody = JSON.parse(message.Body);
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const inputDir = path.join(__dirname, "../input");
    fs.mkdirSync(inputDir, { recursive: true });

    // Assuming message.Body contains the S3 bucket and key
    const bucket = messageBody.Records[0]?.s3?.bucket?.name;
    const rawKey = messageBody.Records[0]?.s3?.object?.key;

    if (!bucket || !rawKey) {
      console.error("bucket or key not found:", messageBody);
      return;
    }

    const key = decodeURIComponent(rawKey.replace(/\+/g, " "));
    const rawVideoUrl = `https://${rawBucket}.s3.${rawRegion}.amazonaws.com/${key}`;

    const video = await db.query.videos.findFirst({
      where: eq(videos.videoUrl, rawVideoUrl),
    });

    if (!video) {
      console.log("Video Entry not found in database for URL: ", rawVideoUrl);
      await deleteFromS3(rawBucket, rawKey);
      console.log("Deleted from raw S3 bucket, key: ", rawKey);
      return;
    }

    const localFilename = path.basename(key);
    const localPath = path.join(inputDir, localFilename);

    const [userId, downloadPath] = await downloadFromS3(bucket, key, localPath);

    const fileName = path.parse(key).name;
    const result = await transcodeAndUploadHLS({
      inputPath: localPath,
      fileName,
      userId,
    });

    await db.insert(videoTranscodings).values({
      videoId: video.id,
      masterUrl: result.masterUrl,
      hsl144pUrl: result.hsl144pUrl,
      hsl240pUrl: result.hsl240pUrl,
      hsl360pUrl: result.hsl360pUrl,
      hsl480pUrl: result.hsl480pUrl,
      hsl720pUrl: result.hsl720pUrl,
    });

    console.log("Transcoding and upload result:", result);
  } catch (error) {
    console.error("Error processing message:", error);
  }
};

const app = Consumer.create({
  queueUrl,
  region,
  handleMessage,
});

app.on("error", (err) => {
  console.error("Error: ", err.message);
});

app.on("processing_error", (err) => {
  console.error("Processing Error: ", err.message);
});

app.start();

console.log("Worker is running...");
