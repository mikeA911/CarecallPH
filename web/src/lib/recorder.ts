// Microphone recording for dictation (clinical notes M6, monitoring plans M5).
// The audio stays in the browser until it is sent once for speech-to-text;
// CareCall never stores it.
import { useEffect, useRef, useState } from "react";

export const MAX_RECORD_SECONDS = 10 * 60;
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

/**
 * Record from the microphone (about 32 kbit/s). `onAudio` gets the recording
 * as base64 when it stops; recording stops by itself at `maxSeconds`.
 */
export function useRecorder(onAudio: (audioBase64: string, mime: string) => void, maxSeconds = MAX_RECORD_SECONDS) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);
  const handler = useRef(onAudio);
  handler.current = onAudio;
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); rec.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  function stop() {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (rec.current?.state === "recording") rec.current.stop();
    setRecording(false);
  }

  async function start() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: 32000 });
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: r.mimeType });
        chunks.current = [];
        handler.current(await blobToBase64(blob), r.mimeType);
      };
      rec.current = r;
      r.start(1000);
      setRecording(true); setSeconds(0);
      timer.current = window.setInterval(() => setSeconds((s) => {
        if (s + 1 >= maxSeconds) stop();
        return s + 1;
      }), 1000);
    } catch {
      setError("Couldn't use the microphone. Allow microphone access in the browser, or type instead.");
    }
  }

  return { recording, seconds, error, start, stop };
}
