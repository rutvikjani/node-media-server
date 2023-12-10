const NodeMediaServer = require("node-media-server");
const fs = require("fs");
const moment = require("moment");
const ffmpeg = require("fluent-ffmpeg");
const NodeRtmpClient = require("node-media-server/src/node_rtmp_client");

const config = {
  rtmp: {
    port: 1935,
    chunk_size: 60000,
    gop_cache: true,
    ping: 60,
    ping_timeout: 30,
  },
  http: {
    port: 8000,
    mediaroot: "./media",
    allow_origin: "*",
  },
};

const nms = new NodeMediaServer(config);

const dateFolder = Date.now();

const outputDir = "./Recordings/";

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

const clients = {}; // Store NodeRtmpClient instances for each stream

nms.on("postPublish", (_, streamPath, _params) => {
  const streamId = streamPath.split("/")[2];

  console.log(
    `Incoming streamPath: ${streamPath}, Extracted streamId: ${streamId}`
  );

  if (!clients[streamId]) {
    const inputURL = `rtmp://localhost:1935/${streamPath.replace(/^\/+/, "")}`;
    clients[streamId] = new NodeRtmpClient(
      inputURL,
      `${outputDir}${streamId}/`
    );
    clients[streamId].inputURL = inputURL;
    clients[streamId].startRecording();
    console.log(`New stream pushed: ${streamId}`);
  } else {
    console.log(
      `Stream already exists. Existing streams: ${Object.keys(clients).join(
        ", "
      )}. Rejecting new stream: ${streamId}`
    );
  }
});

nms.on("donePublish", (_, streamPath, _params) => {
  const streamId = streamPath.split("/")[2];
  console.log(`Stream done: ${streamId}`);

  if (clients[streamId]) {
    clients[streamId].stopRecording();
    delete clients[streamId];
  }
});

// ... (previous code)

nms.run();

// Periodically process streams
setInterval(() => {
  processStreams();
}, 30000);

function processStreams() {
  for (const streamId in clients) {
    const client = clients[streamId];
    if (client && client.inputURL) {
      saveStream(client.inputURL, outputDir, streamId)
        .then(() => {
          console.log(`Stream saved successfully: ${streamId}`);
        })
        .catch((err) => {
          console.error(`Error saving stream ${streamId}:`, err);
        });
    }
  }
}

function saveStream(inputURL, outputDir, streamId) {
  const date = new Date();
  const epochTime = (date.getTime() - date.getMilliseconds()) / 1000;
  let currentDate = new Date().toJSON().slice(0, 10);
  const streamDir = `${outputDir}${streamId}/${currentDate}/`;

  if (!fs.existsSync(streamDir)) {
    try {
      fs.mkdirSync(streamDir, { recursive: true });
    } catch (err) {
      console.error("Error creating directory:", err);
      // Handle the error as needed
      return Promise.reject(err);
    }
  }
  const outputFilename = `${streamDir}index.m3u8`;

  return new Promise((resolve, reject) => {
    ffmpeg(inputURL)
      .inputFormat("flv")
      .outputOptions([
        `-hls_segment_filename ${streamDir}${epochTime}.ts`,
        "-hls_time 30",
        "-hls_list_size 5",
        "-t 30",
        "-f hls",
        "-hls_flags append_list",
        "-strftime 1",
      ])
      .output(outputFilename)
      .on("end", () => {
        console.log(`Saved stream to ${outputFilename}`);
        resolve();
      })
      .on("error", (err, stdout, stderr) => {
        console.error("Error:", err);
        console.error("ffmpeg stdout:", stdout);
        console.error("ffmpeg stderr:", stderr);
        reject(err);
      })
      .run();
  });
}
