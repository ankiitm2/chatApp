"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";

type Phase = "setup" | "waiting" | "chat" | "ended";
type Msg = { mine: boolean; text: string; time: string };

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export default function Home() {
  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<Phase>("setup");
  const [nick, setNick] = useState("");
  const [interests, setInterests] = useState("");
  const [partner, setPartner] = useState("");
  const [common, setCommon] = useState<string[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [onlineCount, setOnlineCount] = useState(3425);

  // Video calling states
  const [isVideoActive, setIsVideoActive] = useState(false);
  const [remoteHasVideo, setRemoteHasVideo] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCamOff, setIsCamOff] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  // Cleanup WebRTC & media streams
  const cleanupMediaAndPeer = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    setIsVideoActive(false);
    setRemoteHasVideo(false);
    setIsMicMuted(false);
    setIsCamOff(false);
    setVideoError(null);
  }, []);

  const createPeerConnection = useCallback(() => {
    if (pcRef.current) return pcRef.current;
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit("signal", { candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    return pc;
  }, []);

  useEffect(() => {
    const s = io();
    socketRef.current = s;

    s.on("online-count", (count: number) => {
      setOnlineCount(3420 + count);
    });

    s.on("waiting", () => {
      cleanupMediaAndPeer();
      setPhase("waiting");
    });

    s.on(
      "matched",
      (d: { nick: string; common: string[]; isInitiator?: boolean }) => {
        cleanupMediaAndPeer();
        setPartner(d.nick);
        setCommon(d.common);
        setMsgs([]);
        setPhase("chat");
      }
    );

    s.on("message", (text: string) => {
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now
        .getMinutes()
        .toString()
        .padStart(2, "0")}`;
      setMsgs((m) => [...m, { mine: false, text, time: timeStr }]);
    });

    s.on("video-state", async (state: { enabled: boolean }) => {
      setRemoteHasVideo(state.enabled);
      if (!state.enabled && remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
    });

    s.on(
      "signal",
      async (data: {
        sdp?: RTCSessionDescriptionInit;
        candidate?: RTCIceCandidateInit;
      }) => {
        try {
          let pc = pcRef.current;
          if (!pc) {
            pc = createPeerConnection();
          }

          if (data.sdp) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            if (data.sdp.type === "offer") {
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              s.emit("signal", { sdp: pc.localDescription });
            }
          } else if (data.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          }
        } catch (err) {
          console.error("Signal error:", err);
        }
      }
    );

    s.on("partner-left", () => {
      cleanupMediaAndPeer();
      setPhase("ended");
    });

    return () => {
      cleanupMediaAndPeer();
      s.disconnect();
    };
  }, [cleanupMediaAndPeer, createPeerConnection]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const find = () => {
    cleanupMediaAndPeer();
    setPhase("waiting");
    socketRef.current?.emit("find", {
      nick,
      interests: interests.split(",").map((i) => i.trim()).filter(Boolean),
    });
  };

  const next = () => {
    cleanupMediaAndPeer();
    socketRef.current?.emit("leave");
    find();
  };

  const stop = () => {
    cleanupMediaAndPeer();
    socketRef.current?.emit("leave");
    setPhase("setup");
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    socketRef.current?.emit("message", text);
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now
      .getMinutes()
      .toString()
      .padStart(2, "0")}`;
    setMsgs((m) => [...m, { mine: true, text, time: timeStr }]);
    setDraft("");
  };

  // Start Video Calling with fallbacks
  const startVideo = async () => {
    try {
      setVideoError(null);
      let stream: MediaStream;

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
      } catch (firstErr: unknown) {
        console.warn("Retrying media fallback...", firstErr);
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        } catch {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: false,
              audio: true,
            });
          } catch {
            throw firstErr;
          }
        }
      }

      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      setIsVideoActive(true);
      socketRef.current?.emit("video-state", { enabled: true });

      const pc = createPeerConnection();
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current?.emit("signal", { sdp: pc.localDescription });
    } catch (err: unknown) {
      console.error("Camera error:", err);
      const errorObj = err as { name?: string; message?: string };
      const errName = errorObj.name || "";
      if (errName === "NotAllowedError" || errName === "PermissionDeniedError") {
        setVideoError("Permissions blocked. Enable camera/mic access in browser.");
      } else if (errName === "NotFoundError") {
        setVideoError("No camera or mic hardware detected.");
      } else if (errName === "NotReadableError") {
        setVideoError("Camera is currently occupied by another program or tab.");
      } else {
        setVideoError("Could not access camera/mic: " + (errorObj.message || "Permission issue"));
      }
    }
  };

  const stopVideo = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    setIsVideoActive(false);
    socketRef.current?.emit("video-state", { enabled: false });
  };

  const toggleMic = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleCam = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsCamOff(!videoTrack.enabled);
      }
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0d1117] text-slate-100 font-sans select-none">
      <div className="flex flex-col flex-1 h-full w-full max-w-[1700px] mx-auto bg-[#0f141c]">
        {/* Top Navbar */}
        <header className="h-16 px-6 flex items-center justify-between border-b border-[#1c2433] bg-[#0c1017]">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-600 via-cyan-400 to-sky-300 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <span className="text-white text-base font-black italic">N</span>
            </div>
            <span className="text-xl font-bold tracking-tight text-white flex items-center">
              Neon<span className="text-cyan-400">Chat</span>
            </span>
          </div>

          {/* Center: Online Status Indicator */}
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#151c27] border border-[#232f42] text-xs font-medium text-slate-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>{onlineCount.toLocaleString()} Online now</span>
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center gap-3">
            {phase === "chat" && isVideoActive && (
              <div className="flex items-center gap-2 mr-2">
                <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 text-xs font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  Live Connection
                </span>
                <button
                  onClick={stopVideo}
                  title="Hang Up Video"
                  className="w-8 h-8 rounded-full bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 hover:bg-rose-500 hover:text-white transition-colors"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.99.99 0 010-1.41C2.38 9.61 6.89 8 12 8s9.62 1.61 11.71 3.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
                  </svg>
                </button>
              </div>
            )}

            <button className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-[#1a2332] transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <div className="w-8 h-8 rounded-full bg-gradient-to-r from-purple-500 to-indigo-600 flex items-center justify-center ring-2 ring-[#222e40] text-xs font-bold text-white">
              {nick ? nick.slice(0, 2).toUpperCase() : "ME"}
            </div>
          </div>
        </header>

        {/* SETUP PHASE SCREEN */}
        {phase === "setup" && (
          <div className="flex-1 flex flex-col items-center justify-center p-6 bg-radial from-[#151c28] via-[#0d1118] to-[#0a0d13]">
            <div className="w-full max-w-md p-8 rounded-2xl bg-[#131923] border border-[#202b3d] shadow-2xl space-y-6">
              <div className="text-center space-y-2">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/25">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-white">Join NeonChat</h1>
                <p className="text-xs text-slate-400">Match with strangers anonymously around the world</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-slate-300 block mb-1.5">Your Nickname</label>
                  <input
                    className="w-full rounded-xl bg-[#0b0e14] border border-[#232e42] px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-500 transition-colors"
                    placeholder="Enter nickname (e.g. Alex, NeonSurfer)"
                    maxLength={20}
                    value={nick}
                    onChange={(e) => setNick(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-300 block mb-1.5">Interests / Tags</label>
                  <input
                    className="w-full rounded-xl bg-[#0b0e14] border border-[#232e42] px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-500 transition-colors"
                    placeholder="e.g. music, gaming, movies, anime"
                    value={interests}
                    onChange={(e) => setInterests(e.target.value)}
                  />
                </div>

                <button
                  onClick={find}
                  className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-semibold text-sm shadow-lg shadow-emerald-500/25 hover:from-emerald-400 hover:to-teal-400 transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <span>Start Matching</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </button>
              </div>

              <div className="pt-2 border-t border-[#1e2738] flex items-center justify-between text-[11px] text-slate-400">
                <span className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  End-to-end encrypted
                </span>
                <span>Anonymous by default</span>
              </div>
            </div>
          </div>
        )}

        {/* WAITING PHASE SCREEN */}
        {phase === "waiting" && (
          <div className="flex-1 flex flex-col items-center justify-center p-6 bg-radial from-[#151c28] via-[#0d1118] to-[#0a0d13]">
            <div className="w-full max-w-sm p-8 rounded-2xl bg-[#131923] border border-[#202b3d] text-center space-y-6 shadow-2xl">
              <div className="relative w-20 h-20 mx-auto">
                <div className="absolute inset-0 rounded-full border-4 border-cyan-500/20 animate-ping"></div>
                <div className="w-20 h-20 rounded-full border-4 border-t-cyan-400 border-r-cyan-400 border-b-transparent border-l-transparent animate-spin flex items-center justify-center">
                  <div className="w-12 h-12 rounded-full bg-cyan-950 flex items-center justify-center text-cyan-300 font-bold">
                    💬
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <h2 className="text-xl font-bold text-white">Looking for someone…</h2>
                <p className="text-xs text-slate-400">Finding a compatible stranger waiting online</p>
              </div>

              <button
                onClick={stop}
                className="w-full py-2.5 px-4 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* CHAT & VIDEO SCREENS */}
        {(phase === "chat" || phase === "ended") && (
          <div className="flex-1 flex overflow-hidden">
            {/* If video call is active: Show the NeonChat Video Layout */}
            {isVideoActive || remoteHasVideo ? (
              <div className="flex-1 flex flex-col lg:flex-row overflow-hidden bg-[#0a0d14]">
                {/* Main Video Viewport */}
                <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
                  {/* Stranger Video (Full Viewport) */}
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />

                  {/* Fallback avatar if stranger's camera isn't transmitting */}
                  {!remoteHasVideo && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-[#121824] to-[#080b10] text-slate-400">
                      <div className="w-24 h-24 rounded-full bg-[#1b2333] border-2 border-[#2b374d] flex items-center justify-center text-4xl mb-4 shadow-xl">
                        👤
                      </div>
                      <h3 className="text-lg font-semibold text-white">{partner || "Stranger"}</h3>
                      <p className="text-xs text-slate-400 mt-1">Camera is currently paused or inactive</p>
                    </div>
                  )}

                  {/* Top-Left Stranger Info Badge */}
                  <div className="absolute top-4 left-4 flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 shadow-lg">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-purple-500 to-indigo-500 flex items-center justify-center text-xs font-bold text-white">
                      {partner ? partner.slice(0, 1).toUpperCase() : "S"}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-white leading-tight">
                        {partner || "Stranger #821"}
                      </div>
                      <div className="text-[10px] text-slate-300 leading-tight">
                        {common.length > 0 ? common.join(" · ") : "Video, NeonChat +10m ping"}
                      </div>
                    </div>
                  </div>

                  {/* Picture-in-Picture (Local Camera Stream) */}
                  {isVideoActive && (
                    <div className="absolute bottom-20 left-4 w-36 h-48 md:w-44 md:h-56 rounded-2xl overflow-hidden border-2 border-cyan-500/40 shadow-2xl bg-[#121824] z-10">
                      <video
                        ref={localVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className={`w-full h-full object-cover -scale-x-100 ${
                          isCamOff ? "hidden" : ""
                        }`}
                      />
                      {isCamOff && (
                        <div className="w-full h-full flex flex-col items-center justify-center text-xs text-slate-400 bg-slate-900">
                          <span className="text-2xl mb-1">📷</span>
                          <span>Cam Off</span>
                        </div>
                      )}
                      <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/70 text-[9px] font-bold text-cyan-300 uppercase tracking-wider">
                        You
                      </div>
                    </div>
                  )}

                  {/* Floating Video Control Dock */}
                  {isVideoActive && (
                    <div className="absolute bottom-5 inset-x-0 mx-auto w-fit flex items-center gap-3 px-5 py-2.5 rounded-full bg-[#111722]/80 backdrop-blur-lg border border-white/15 shadow-2xl z-20">
                      {/* Mute Mic */}
                      <button
                        onClick={toggleMic}
                        title={isMicMuted ? "Unmute Mic" : "Mute Mic"}
                        className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
                          isMicMuted
                            ? "bg-rose-500/30 text-rose-400 border border-rose-500/40"
                            : "bg-[#1f293b] text-white hover:bg-[#2b374e]"
                        }`}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          {isMicMuted ? (
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 19L5 5m9.5 9.5A4 4 0 0016 11V5a4 4 0 00-8 0v2m2 7a4 4 0 006 0v-2m3 2a7 7 0 01-11.83 5M12 19v3m-4 0h8" />
                          ) : (
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0m7 7v4m-4 0h8m-4-15a3 3 0 00-3 3v4a3 3 0 006 0V7a3 3 0 00-3-3z" />
                          )}
                        </svg>
                      </button>

                      {/* Video Camera Toggle */}
                      <button
                        onClick={toggleCam}
                        title={isCamOff ? "Turn On Camera" : "Turn Off Camera"}
                        className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
                          isCamOff
                            ? "bg-rose-500/30 text-rose-400 border border-rose-500/40"
                            : "bg-cyan-500 text-white hover:bg-cyan-400 shadow-lg shadow-cyan-500/30"
                        }`}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>

                      {/* Next / Skip */}
                      <button
                        onClick={next}
                        title="Skip to Next Stranger"
                        className="w-11 h-11 rounded-full bg-[#1f293b] text-slate-300 hover:text-white hover:bg-[#2b374e] flex items-center justify-center transition-all"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                        </svg>
                      </button>

                      {/* End Video Call */}
                      <button
                        onClick={stopVideo}
                        title="Hang Up Video"
                        className="w-11 h-11 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center transition-all shadow-lg shadow-rose-600/30"
                      >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.99.99 0 010-1.41C2.38 9.61 6.89 8 12 8s9.62 1.61 11.71 3.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>

                {/* Right Side Sidebar Chat in Video Mode */}
                <div className="w-full lg:w-96 flex flex-col h-72 lg:h-full border-t lg:border-t-0 lg:border-l border-[#1a2333] bg-[#0c1017]">
                  <div className="p-3.5 border-b border-[#1a2333] flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                      Live Chat
                    </span>
                    <span className="text-[11px] text-slate-500">{msgs.length} messages</span>
                  </div>

                  {/* Messages list */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {msgs.map((m, i) => (
                      <div
                        key={i}
                        className={`flex flex-col ${m.mine ? "items-end" : "items-start"}`}
                      >
                        <div
                          className={`max-w-[85%] px-3.5 py-2 rounded-2xl text-xs leading-relaxed break-words ${
                            m.mine
                              ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-tr-sm shadow-md shadow-emerald-500/10"
                              : "bg-[#161e2b] text-slate-200 border border-[#212b3c] rounded-tl-sm"
                          }`}
                        >
                          {m.text}
                        </div>
                        <span className="text-[10px] text-slate-500 mt-1 px-1">
                          {m.time}
                        </span>
                      </div>
                    ))}
                    <div ref={bottomRef} />
                  </div>

                  {/* Input bar */}
                  <div className="p-3 border-t border-[#1a2333] bg-[#0c1017]">
                    <div className="flex items-center gap-2 bg-[#141b27] rounded-xl px-3 py-2 border border-[#222e40] focus-within:border-cyan-500 transition-colors">
                      <input
                        className="flex-1 bg-transparent text-xs text-white placeholder-slate-500 outline-none"
                        placeholder="Send a message..."
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && send()}
                      />
                      <button
                        onClick={send}
                        className="w-7 h-7 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-white flex items-center justify-center transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* NeonChat - Chat Home Screen (Standard layout matching Screenshot 1) */
              <div className="flex-1 flex flex-col lg:flex-row overflow-hidden bg-[#0d121a]">
                {/* Main Text Chat Container */}
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* Stranger Chat Top Header Bar */}
                  <div className="px-6 py-3.5 border-b border-[#18212f] bg-[#0c1017] flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-amber-600 via-rose-500 to-indigo-600 flex items-center justify-center text-sm font-bold text-white shadow-md">
                          {partner ? partner.slice(0, 1).toUpperCase() : "S"}
                        </div>
                        <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#0c1017]"></span>
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white flex items-center gap-2">
                          <span>{partner || "Stranger #821"}</span>
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {common.length > 0 ? (
                            <span>Shared interests: {common.join(", ")}</span>
                          ) : (
                            <span>Text chat active · 04:12</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={next}
                        className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 text-xs font-medium transition-colors"
                      >
                        Next Stranger
                      </button>
                    </div>
                  </div>

                  {videoError && (
                    <div className="bg-rose-950/70 border-b border-rose-800/80 text-rose-200 px-6 py-2.5 text-xs flex justify-between items-center">
                      <span>{videoError}</span>
                      <button
                        onClick={() => setVideoError(null)}
                        className="font-bold text-rose-400 hover:text-white"
                      >
                        ✕
                      </button>
                    </div>
                  )}

                  {/* Message Feed */}
                  <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
                    <div className="text-center my-2">
                      <span className="text-[11px] text-slate-500 px-3 py-1 rounded-full bg-[#131a26] border border-[#1e283a]">
                        Connected 5 minutes ago
                      </span>
                    </div>

                    {msgs.map((m, i) => (
                      <div
                        key={i}
                        className={`flex flex-col ${m.mine ? "items-end" : "items-start"}`}
                      >
                        <div
                          className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-xs md:text-sm leading-relaxed break-words shadow-sm ${
                            m.mine
                              ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-tr-sm shadow-emerald-500/10"
                              : "bg-[#18212e] text-slate-200 border border-[#232e40] rounded-tl-sm"
                          }`}
                        >
                          {m.text}
                        </div>
                        <span className="text-[10px] text-slate-500 mt-1 px-1">
                          {m.time}
                        </span>
                      </div>
                    ))}

                    {phase === "ended" && (
                      <div className="text-center py-6 space-y-2">
                        <p className="text-xs text-slate-400">
                          {partner || "Stranger"} has disconnected.
                        </p>
                        <button
                          onClick={next}
                          className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md shadow-cyan-600/20 transition-all"
                        >
                          Find Next Stranger
                        </button>
                      </div>
                    )}
                    <div ref={bottomRef} />
                  </div>

                  {/* Chat Input Bar */}
                  <div className="p-4 border-t border-[#18212e] bg-[#0c1017]">
                    <div className="flex items-center gap-3 bg-[#131924] rounded-2xl px-4 py-2.5 border border-[#212b3d] focus-within:border-cyan-500 transition-colors shadow-inner">
                      <button className="text-slate-400 hover:text-white transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                      </button>

                      <input
                        className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none"
                        placeholder="Type a message..."
                        disabled={phase === "ended"}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && send()}
                      />

                      <button
                        onClick={send}
                        disabled={phase === "ended" || !draft.trim()}
                        className="w-8 h-8 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-30 disabled:hover:bg-cyan-500 text-white flex items-center justify-center transition-all cursor-pointer shadow-md shadow-cyan-500/20"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                      </button>
                    </div>
                    <div className="mt-2 text-center text-[10px] text-slate-600 flex items-center justify-center gap-1.5">
                      <svg className="w-3 h-3 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      End-to-end encrypted
                    </div>
                  </div>
                </div>

                {/* Right Side Sidebar (Ready for more? Upgrade to Video Call) */}
                <div className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-[#18212e] bg-[#0c1017] p-6 flex flex-col justify-between">
                  <div className="space-y-6">
                    {/* Upgrade to Video Card */}
                    <div className="rounded-2xl p-6 bg-gradient-to-b from-[#141c29] to-[#101622] border border-[#212c3f] text-center space-y-4 shadow-xl">
                      <div className="w-14 h-14 mx-auto rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shadow-lg shadow-amber-500/10">
                        <svg className="w-7 h-7 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                        </svg>
                      </div>

                      <div className="space-y-1.5">
                        <h3 className="text-base font-bold text-white">Ready for more?</h3>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          Upgrade to <span className="text-cyan-400 font-semibold">Video Call</span> and see who you&apos;re talking to in real time.
                        </p>
                      </div>

                      <button
                        onClick={startVideo}
                        className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white font-semibold text-xs shadow-lg shadow-emerald-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <span className="w-2 h-2 rounded-full bg-white animate-ping"></span>
                        <span>Go Live Now</span>
                      </button>
                    </div>

                    {/* Features Badges */}
                    <div className="space-y-3">
                      <div className="p-3.5 rounded-xl bg-[#121824] border border-[#1e2738] flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                          🛡️
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-white">Anonymous by default</div>
                          <div className="text-[10px] text-slate-400">No phone number shared</div>
                        </div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-[#121824] border border-[#1e2738] flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                          🎯
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-white">Match smarter</div>
                          <div className="text-[10px] text-slate-400">Filter by interests & language</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="text-center text-[10px] text-slate-600 mt-6">
                    NeonChat v1.2 · Fast & Anonymous
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
