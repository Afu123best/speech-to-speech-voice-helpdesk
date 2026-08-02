const startBtn = document.getElementById("startBtn");

startBtn.addEventListener("click", async () => {
    const socket = new WebSocket("ws://localhost:3002");
    socket.binaryType = "arraybuffer";

    socket.onopen = async () => {
        console.log("Connected to backend relay");

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 16000
            }
        });

        const audioContext = new AudioContext({ sampleRate: 16000 });
        await audioContext.audioWorklet.addModule("pcm-processor.js");

        const source = audioContext.createMediaStreamSource(stream);
        const workletNode = new AudioWorkletNode(audioContext, "pcm-processor");

        workletNode.port.onmessage = (event) => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(event.data);
            }
        };

        source.connect(workletNode);

        console.log("Streaming microphone audio...");

        let nextPlayTime = 0;
        let activeSources = [];
        const playbackContext = new AudioContext({ sampleRate: 24000 });

        socket.onmessage = (event) => {
            if (typeof event.data === "string") {
                const message = JSON.parse(event.data);
                if (message.type === "interrupted") {
                    stopPlayback();
                }
                return;
            }
            
            playAudioChunk(event.data);
        };

        function stopPlayback() {
            activeSources.forEach(source => {
                try {
                    source.stop();
                } catch (e) {
                    //already stopped, ignore
                }
            });
            activeSources = [];
            nextPlayTime = playbackContext.currentTime;
        }

        function playAudioChunk(arrayBuffer) {
            const int16Data = new Int16Array(arrayBuffer);

            if (arrayBuffer.byteLength === 0) {
                return;
            }


            const float32Data = new Float32Array(int16Data.length);

            for (let i = 0; i < int16Data.length; i++) {
                float32Data[i] = int16Data[i] / 32768;
            }

            const audioBuffer = playbackContext.createBuffer(1, float32Data.length, 24000);
            audioBuffer.copyToChannel(float32Data, 0);

            const bufferSource = playbackContext.createBufferSource();
            bufferSource.buffer = audioBuffer;
            bufferSource.connect(playbackContext.destination);

            activeSources.push(bufferSource);
            bufferSource.onended = () => {
                activeSources = activeSources.filter(s => s !== bufferSource);
            };

            const currentTime = playbackContext.currentTime;
            const startTime = Math.max(currentTime, nextPlayTime);

            bufferSource.start(startTime);
            nextPlayTime = startTime + audioBuffer.duration;
        }
    };

    socket.onclose = () => {
        console.log("Backend relay disconnected");
    };
});