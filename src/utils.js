import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import fs from "fs";
import { pipeline } from "stream";
import { promisify } from "util";
import path from "path";
import { exec } from "child_process";

const rawRegion = process.env.AWS_S3_RAW_REGION;
export const s3RawClient = new S3Client({
  region: rawRegion,
  endpoint: process.env.AWS_S3_RAW_ENDPOINT,
  Credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const region = process.env.AWS_S3_REGION;
export const s3Client = new S3Client({
  region,
  Credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// downloadFromS3
export async function downloadFromS3(bucket, key, downloadPath) {
  const file = fs.createWriteStream(downloadPath);
  const streamPipeline = promisify(pipeline);
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const headCommand = new HeadObjectCommand({ Bucket: bucket, Key: key });

  try {
    const response = await s3RawClient.send(command);
    const readStream = response.Body;
    await streamPipeline(readStream, file);
    const headResult = await s3RawClient.send(headCommand);
    const userId = headResult.Metadata?.["user-id"] || "unknown-user";
    console.log("video from userId: ", userId);
    return [userId, downloadPath];
  } catch (error) {
    console.error("Error downloading from S3:", error);
  }
}

// deleteFromS3
export async function deleteFromS3(rawBucket, key) {
  const deleteCommand = new DeleteObjectCommand({
    Bucket: rawBucket,
    Key: key,
  });
  await s3RawClient.send(deleteCommand);
  console.log("Entry not found in database, removed from rawS3, key: ", key);
}

// transcodeAndUploadHLS
export async function transcodeAndUploadHLS({
  inputPath,
  fileName,
  userId,
  outputRoot = "output",
}) {
  const outputDir = path.join(outputRoot, userId, `${fileName}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const execPromise = promisify(exec);
  const bucket = process.env.AWS_S3_BUCKET;

  const resolutions = [
    { name: "144p", size: "256x144" },
    { name: "240p", size: "426x240" },
    { name: "360p", size: "640x360" },
    { name: "480p", size: "854x480" },
    { name: "720p", size: "1280x720" },
  ];

  console.log("🎬 Starting transcoding... ", fileName);
  for (const reso of resolutions) {
    const outPath = path.join(outputDir, reso.name);
    fs.mkdirSync(outPath, { recursive: true });

    const cmd = `ffmpeg -i "${inputPath}" -vf scale=${reso.size} -codec:v libx264 -codec:a aac -hls_time 10 -hls_playlist_type vod -hls_segment_filename "${outPath}/s%09d.ts" "${outPath}/index.m3u8"`;

    await execPromise(cmd);
  }

  console.log("✅ Transcoding complete");

  // Generate master playlist
  const masterPlaylistPath = path.join(outputDir, "index.m3u8");
  let masterContent = "#EXTM3U\n";
  for (const reso of resolutions) {
    const bandwidth = {
      "144p": 200000,
      "240p": 400000,
      "360p": 800000,
      "480p": 1400000,
      "720p": 2800000,
    }[reso.name];
    const resolution = {
      "144p": "256x144",
      "240p": "426x240",
      "360p": "640x360",
      "480p": "854x480",
      "720p": "1280x720",
    }[reso.name];
    masterContent += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution}\n${reso.name}/index.m3u8\n`;
  }
  fs.writeFileSync(masterPlaylistPath, masterContent);

  // Upload HLS files
  console.log("☁️ Uploading to S3:", bucket);
  for (const reso of resolutions) {
    const resoDir = path.join(outputDir, reso.name);
    const files = fs.readdirSync(resoDir);
    for (const file of files) {
      const filePath = path.join(resoDir, file);
      const s3Key = `${userId}/${fileName}/${reso.name}/${file}`;
      const contentType = file.endsWith(".m3u8")
        ? "application/vnd.apple.mpegurl"
        : "video/MP2T";
      const fileContent = fs.readFileSync(filePath);

      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: s3Key,
          Body: fileContent,
          ContentType: contentType,
        })
      );
    }
  }

  // Upload master playlist
  const masterContentBuf = fs.readFileSync(masterPlaylistPath);
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `${userId}/${fileName}/index.m3u8`,
      Body: masterContentBuf,
      ContentType: "application/vnd.apple.mpegurl",
    })
  );

  console.log("✅ Upload complete");

  // Cleanup
  console.log("cleaning up...");
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.rmSync(inputPath, { recursive: true, force: true });

  return {
    masterUrl: `https://${bucket}.s3.${region}.amazonaws.com/${userId}/${fileName}/index.m3u8`,
    hsl144pUrl: `https://${bucket}.s3.${region}.amazonaws.com/${userId}/${fileName}/144p/index.m3u8`,
    hsl240pUrl: `https://${bucket}.s3.${region}.amazonaws.com/${userId}/${fileName}/240p/index.m3u8`,
    hsl360pUrl: `https://${bucket}.s3.${region}.amazonaws.com/${userId}/${fileName}/360p/index.m3u8`,
    hsl480pUrl: `https://${bucket}.s3.${region}.amazonaws.com/${userId}/${fileName}/480p/index.m3u8`,
    hsl720pUrl: `https://${bucket}.s3.${region}.amazonaws.com/${userId}/${fileName}/720p/index.m3u8`,
  };
}
