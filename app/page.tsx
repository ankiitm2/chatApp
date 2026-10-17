"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import {
  getOrCreateUserProfile,
  recordMatchHistory,
  saveFriendship,
  fetchFriends,
  fetchMatchHistory,
  FriendItem,
  MatchHistoryItem,
} from "./lib/db";

type Phase = "setup" | "waiting" | "chat" | "ended" | "history";
type Gender = "male" | "female" | "other";
type ConversationStyle = "text" | "video";
type Msg = { mine: boolean; text: string; time: string };

const ANONYMOUS_NAMES = [
  "Clover",
  "Drifter",
  "Nova",
  "River",
  "Atlas",
  "Echo",
  "Sol",
  "Sage",
  "Zephyr",
  "Rowan",
  "Skye",
  "Loomis",
  "Marlowe",
  "Juniper",
  "Kai",
  "Sora",
];

const PRESET_TOPICS = [
  "Music",
  "Travel",
  "Books",
  "Late-night thoughts",
  "Gaming",
  "Philosophy",
  "Movies",
  "Art & Design",
  "Tech & Code",
  "Coffee & Tea",
  "Food & Cooking",
  "Stargazing",
];

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

  // Dark mode state
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Core flow
  const [phase, setPhase] = useState<Phase>("setup");
  const [nick, setNick] = useState("Clover");
  const [selectedTopics, setSelectedTopics] = useState<string[]>(["Music", "Late-night thoughts"]);
  const [customTopic, setCustomTopic] = useState("");
  const [topicInputError, setTopicInputError] = useState<string | null>(null);
  const [conversationStyle, setConversationStyle] = useState<ConversationStyle>("text");
  const [gender, setGender] = useState<Gender>("other");

  // Mobile multi-step wizard state (Step 1: Name, Step 2: Topics, Step 3: Style)
  const [mobileStep, setMobileStep] = useState<1 | 2 | 3>(1);

  // Searching elapsed time
  const [searchElapsedSeconds, setSearchElapsedSeconds] = useState(0);

  // Partner info
  const [partner, setPartner] = useState("River");
  const [partnerGender, setPartnerGender] = useState<Gender>("female");
  const [partnerLocation, setPartnerLocation] = useState("Listening from Portland");
  const [partnerStyle, setPartnerStyle] = useState<ConversationStyle>("text");
  const [common, setCommon] = useState<string[]>(["Music"]);
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      mine: false,
      text: "Hey Clover! What have you been listening to lately?",
      time: "12:40",
    },
    {
      mine: true,
      text: "A lot of mellow indie. I'm trying to build a rainy-day playlist.",
      time: "12:41",
    },
    {
      mine: false,
      text: "That sounds perfect. Send me your first three picks?",
      time: "12:42",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [onlineCount, setOnlineCount] = useState(3842);

  // Video call duration timer
  const [callDurationSeconds, setCallDurationSeconds] = useState(222);

  // Supabase User & Data state
  const [userId, setUserId] = useState<string | null>(null);
  const [friendsList, setFriendsList] = useState<FriendItem[]>([]);
  const [historyList, setHistoryList] = useState<MatchHistoryItem[]>([]);
  const [friendRequestsCount, setFriendRequestsCount] = useState(2);
  const [showReviewRequestsModal, setShowReviewRequestsModal] = useState(false);
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [legalModal, setLegalModal] = useState<"guidelines" | "privacy" | "terms" | null>(null);

  // Friend System states
  const [friendStatus, setFriendStatus] = useState<"none" | "sent" | "received" | "friends">("none");
  const [showToast, setShowToast] = useState<string | null>(null);

  // Video Call Request / Calling states
  const [outgoingCallWaiting, setOutgoingCallWaiting] = useState(false);
  const [incomingCallRequest, setIncomingCallRequest] = useState<boolean>(false);

  // Video calling states
  const [isVideoActive, setIsVideoActive] = useState(false);
  const [hasLocalMedia, setHasLocalMedia] = useState(false);
  const [remoteHasVideo, setRemoteHasVideo] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCamOff, setIsCamOff] = useState(false);
  const [showChatInVideo, setShowChatInVideo] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  // Initialize theme from system or saved preference
  useEffect(() => {
    const saved = localStorage.getItem("qs_theme");
    if (saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      setIsDarkMode(true);
      document.documentElement.classList.add("dark");
    } else {
      setIsDarkMode(false);
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const toggleTheme = () => {
    const nextDark = !isDarkMode;
    setIsDarkMode(nextDark);
    if (nextDark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("qs_theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("qs_theme", "light");
    }
  };

  // Load friends and history on mount
  useEffect(() => {
    fetchFriends(null).then(setFriendsList);
    fetchMatchHistory(null).then(setHistoryList);
  }, []);

  // Timer for video call
  useEffect(() => {
    if (!isVideoActive) return;
    const interval = setInterval(() => {
      setCallDurationSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isVideoActive]);

  // Timer for searching / matching
  useEffect(() => {
    if (phase !== "waiting") {
      setSearchElapsedSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      setSearchElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, "0");
    const secs = (totalSeconds % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  };

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
    setHasLocalMedia(false);
    setRemoteHasVideo(false);
    setIsMicMuted(false);
    setIsCamOff(false);
    setVideoError(null);
    setFriendStatus("none");
    setOutgoingCallWaiting(false);
    setIncomingCallRequest(false);
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

    return pc;
  }, []);

  const acquireLocalMedia = useCallback(async (): Promise<MediaStream | null> => {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch {
      try {
        return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch {
        try {
          return await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        } catch {
          return null;
        }
      }
    }
  }, []);

  const establishCall = useCallback(
    async (isCaller: boolean) => {
      setIsVideoActive(true);
      setOutgoingCallWaiting(false);
      setIncomingCallRequest(false);
      setCallDurationSeconds(0);

      const stream = await acquireLocalMedia();
      localStreamRef.current = stream;

      if (stream) {
        setHasLocalMedia(true);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        socketRef.current?.emit("video-state", { enabled: true });
      } else {
        setHasLocalMedia(false);
        setVideoError("Camera/Mic not detected. Viewing stranger without video.");
        socketRef.current?.emit("video-state", { enabled: false });
      }

      const pc = createPeerConnection();

      if (stream) {
        const senders = pc.getSenders();
        stream.getTracks().forEach((track) => {
          const alreadyAdded = senders.some((s) => s.track === track);
          if (!alreadyAdded) {
            pc.addTrack(track, stream);
          }
        });
      }

      if (isCaller) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current?.emit("signal", { sdp: pc.localDescription });
      }
    },
    [acquireLocalMedia, createPeerConnection]
  );

  // Socket.IO mount
  useEffect(() => {
    const s = io();
    socketRef.current = s;

    s.on("online-count", (count: number) => {
      setOnlineCount(3800 + count);
    });

    s.on("waiting", () => {
      cleanupMediaAndPeer();
      setPhase("waiting");
    });

    s.on(
      "matched",
      (d: {
        nick: string;
        gender?: Gender;
        interests?: string[];
        style?: ConversationStyle;
        common: string[];
        isInitiator?: boolean;
      }) => {
        cleanupMediaAndPeer();
        setPartner(d.nick || "River");
        setPartnerGender(d.gender || "female");
        setPartnerStyle(d.style || "text");
        setCommon(d.common && d.common.length > 0 ? d.common : selectedTopics.slice(0, 1));
        setMsgs([]);
        setPhase("chat");

        const cities = [
          "Listening from Portland",
          "Listening from Seattle",
          "Listening from Brooklyn",
          "Listening from Austin",
          "Listening from London",
          "Listening from Montreal",
        ];
        setPartnerLocation(cities[Math.floor(Math.random() * cities.length)]);

        // Record to history
        const savedId = typeof window !== "undefined" ? localStorage.getItem("neonchat_user_id") : null;
        recordMatchHistory(savedId, d.nick || "River", d.gender || "female", d.common || []);
        fetchMatchHistory(savedId).then(setHistoryList);
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

    s.on("call-request", () => {
      setIncomingCallRequest(true);
      setShowToast("Incoming Video Call request from " + (partner || "Stranger"));
    });

    s.on("call-cancel", () => {
      setIncomingCallRequest(false);
      setShowToast("Call was cancelled by stranger.");
      setTimeout(() => setShowToast(null), 3000);
    });

    s.on("call-response", async (response: { accepted: boolean }) => {
      setOutgoingCallWaiting(false);
      if (response.accepted) {
        setShowToast("Call accepted! Connecting...");
        setTimeout(() => setShowToast(null), 3000);
        await establishCall(true);
      } else {
        setShowToast("Stranger is not available for video right now.");
        setTimeout(() => setShowToast(null), 3000);
      }
    });

    s.on("friend-request", () => {
      setFriendStatus("received");
      setShowToast(`${partner || "Stranger"} sent you a friend request!`);
      setTimeout(() => setShowToast(null), 4000);
    });

    s.on("friend-accept", () => {
      setFriendStatus("friends");
      setShowToast(`You and ${partner || "Stranger"} are now connected! 💜`);
      setTimeout(() => setShowToast(null), 4000);
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
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const toggleTopic = (topic: string) => {
    setTopicInputError(null);
    if (selectedTopics.includes(topic)) {
      if (selectedTopics.length > 1) {
        setSelectedTopics(selectedTopics.filter((t) => t !== topic));
      }
    } else {
      if (selectedTopics.length >= 5) {
        setTopicInputError("You can choose up to 5 topics.");
        return;
      }
      setSelectedTopics([...selectedTopics, topic]);
    }
  };

  const addCustomTopic = () => {
    const trimmed = customTopic.trim();
    if (!trimmed) return;
    if (selectedTopics.map((t) => t.toLowerCase()).includes(trimmed.toLowerCase())) {
      setTopicInputError(`"${trimmed}" is already added.`);
      return;
    }
    if (selectedTopics.length >= 5) {
      setTopicInputError("Maximum 5 topics reached.");
      return;
    }
    setSelectedTopics([...selectedTopics, trimmed]);
    setCustomTopic("");
    setTopicInputError(null);
  };

  const shuffleNickname = () => {
    const filtered = ANONYMOUS_NAMES.filter((n) => n !== nick);
    const chosen = filtered[Math.floor(Math.random() * filtered.length)];
    setNick(chosen);
  };

  const surpriseTopics = () => {
    const shuffled = [...PRESET_TOPICS].sort(() => 0.5 - Math.random());
    const count = Math.floor(Math.random() * 2) + 2; // 2 or 3 topics
    setSelectedTopics(shuffled.slice(0, count));
    setShowToast("Picked random topics for you!");
    setTimeout(() => setShowToast(null), 2500);
  };

  const find = async () => {
    cleanupMediaAndPeer();
    setPhase("waiting");

    const uid = await getOrCreateUserProfile(nick || "Clover", gender, selectedTopics);
    if (uid) setUserId(uid);

    socketRef.current?.emit("find", {
      nick: nick || "Clover",
      gender,
      interests: selectedTopics,
      style: conversationStyle,
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

  const sendFriendRequest = () => {
    socketRef.current?.emit("friend-request", { nick, gender });
    setFriendStatus("sent");
    setShowToast("Friend request sent!");
    setTimeout(() => setShowToast(null), 3000);
  };

  const acceptFriendRequest = async () => {
    socketRef.current?.emit("friend-accept", { nick, gender });
    setFriendStatus("friends");
    setShowToast(`You and ${partner || "Stranger"} are now friends! 💜`);
    setTimeout(() => setShowToast(null), 4000);

    await saveFriendship(userId, partner, partnerGender);
    fetchFriends(userId).then(setFriendsList);
  };

  const requestVideoCall = () => {
    setOutgoingCallWaiting(true);
    socketRef.current?.emit("call-request", { from: nick });
    setShowToast("Requesting video call with stranger...");
  };

  const cancelCallRequest = () => {
    setOutgoingCallWaiting(false);
    socketRef.current?.emit("call-cancel");
    setShowToast("Video request cancelled.");
    setTimeout(() => setShowToast(null), 3000);
  };

  const acceptVideoCall = async () => {
    setIncomingCallRequest(false);
    socketRef.current?.emit("call-response", { accepted: true });
    await establishCall(false);
  };

  const declineVideoCall = () => {
    setIncomingCallRequest(false);
    socketRef.current?.emit("call-response", { accepted: false });
    setShowToast("Declined video call.");
    setTimeout(() => setShowToast(null), 3000);
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

  // Avatar helper
  const renderAvatar = (name: string, size = "w-10 h-10 text-sm") => {
    const isRiver = name.toLowerCase().includes("river");
    const isSunny = name.toLowerCase().includes("sunny");
    const isAtlas = name.toLowerCase().includes("atlas");

    if (isRiver) {
      return (
        <div className={`${size} rounded-full overflow-hidden bg-amber-100 flex items-center justify-center shrink-0 border border-slate-200 dark:border-slate-700 shadow-xs`}>
          <img
            src="https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80"
            alt={name}
            className="w-full h-full object-cover"
          />
        </div>
      );
    }
    if (isAtlas) {
      return (
        <div className={`${size} rounded-full overflow-hidden bg-slate-200 flex items-center justify-center shrink-0 border border-slate-200 dark:border-slate-700 shadow-xs`}>
          <img
            src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80"
            alt={name}
            className="w-full h-full object-cover"
          />
        </div>
      );
    }
    if (isSunny) {
      return (
        <div className={`${size} rounded-full overflow-hidden bg-rose-100 flex items-center justify-center shrink-0 border border-slate-200 dark:border-slate-700 shadow-xs`}>
          <img
            src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80"
            alt={name}
            className="w-full h-full object-cover"
          />
        </div>
      );
    }

    const initial = name ? name.slice(0, 1).toUpperCase() : "S";
    return (
      <div className={`${size} rounded-full bg-gradient-to-tr from-[#5b4df2] to-[#7f74fb] flex items-center justify-center font-bold text-white shadow-xs shrink-0`}>
        <span>{initial}</span>
      </div>
    );
  };

  return (
    <div className="flex h-[100dvh] w-screen overflow-hidden bg-[#f8fafc] dark:bg-[#0b0f19] text-slate-800 dark:text-slate-100 font-sans select-none antialiased transition-colors duration-200">
      {/* Toast Notification */}
      {showToast && (
        <div className="fixed top-5 right-5 z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2.5 animate-in slide-in-from-top-2 duration-200">
          <div className="w-2 h-2 rounded-full bg-[#5b4df2] animate-ping" />
          <span className="text-xs font-semibold">{showToast}</span>
        </div>
      )}

      {/* Incoming Call Request Modal */}
      {incomingCallRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-6 text-center space-y-5 shadow-2xl">
            <div className="relative w-20 h-20 mx-auto">
              <div className="absolute inset-0 rounded-full border-4 border-[#5b4df2]/30 animate-ping"></div>
              {renderAvatar(partner, "w-20 h-20 text-3xl")}
            </div>

            <div className="space-y-1">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">{partner || "Stranger"}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Would like to start a video call with you.</p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={declineVideoCall}
                className="flex-1 py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs transition-colors cursor-pointer"
              >
                Decline
              </button>
              <button
                onClick={acceptVideoCall}
                className="flex-1 py-2.5 px-4 rounded-xl bg-[#5b4df2] hover:bg-[#4d3fe0] text-white font-semibold text-xs shadow-md shadow-[#5b4df2]/25 transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                </svg>
                <span>Accept</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Safety Guide Modal */}
      {showSafetyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-[#5b4df2] flex items-center justify-center">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Safety & Moderation Guide</h3>
              </div>
              <button
                onClick={() => setShowSafetyModal(false)}
                className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center justify-center text-xs"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600 dark:text-slate-300 max-h-[70vh] overflow-y-auto pr-1">
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 flex items-start gap-3">
                <span className="text-lg">🛡️</span>
                <div>
                  <h4 className="font-semibold text-slate-900 dark:text-white">Anonymous by default</h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Your email, location, and device details are never exposed. You only share what you choose.</p>
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 flex items-start gap-3">
                <span className="text-lg">🚫</span>
                <div>
                  <h4 className="font-semibold text-slate-900 dark:text-white">Strict 18+ policy</h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Quiet Signal is designed exclusively for adults 18 and older. Underage use is prohibited.</p>
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 flex items-start gap-3">
                <span className="text-lg">🗑️</span>
                <div>
                  <h4 className="font-semibold text-slate-900 dark:text-white">Zero chat retention</h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Chats live only in memory between connected devices. Messages vanish the moment a session closes.</p>
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 flex items-start gap-3">
                <span className="text-lg">🚩</span>
                <div>
                  <h4 className="font-semibold text-slate-900 dark:text-white">Instant report & block</h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Automated screening and one-click reporting prevent repeat misconduct.</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowSafetyModal(false)}
              className="w-full py-2.5 rounded-xl bg-[#5b4df2] text-white text-xs font-semibold hover:bg-[#4d3fe0] transition-colors"
            >
              Understood
            </button>
          </div>
        </div>
      )}

      {/* Legal & Policy Modals (Guidelines / Privacy / Terms) */}
      {legalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-white capitalize">
                {legalModal === "guidelines" ? "Community Guidelines" : legalModal === "privacy" ? "Privacy Policy" : "Terms of Service"}
              </h3>
              <button
                onClick={() => setLegalModal(null)}
                className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center justify-center text-xs"
              >
                ✕
              </button>
            </div>

            <div className="text-xs text-slate-600 dark:text-slate-300 space-y-3 max-h-[60vh] overflow-y-auto pr-1 leading-relaxed">
              {legalModal === "guidelines" && (
                <>
                  <p className="font-semibold text-slate-900 dark:text-white">Be kind, genuine, and respectful.</p>
                  <p>1. Respect consent: Do not pressure strangers for personal social accounts, real names, or video.</p>
                  <p>2. Zero harassment tolerance: Hate speech, harassment, bullying, and illicit material result in immediate permanent IP blocks.</p>
                  <p>3. 18+ Only: All users must be at least eighteen years of age.</p>
                </>
              )}
              {legalModal === "privacy" && (
                <>
                  <p className="font-semibold text-slate-900 dark:text-white">Privacy by architecture, not by promise.</p>
                  <p>• <strong>No Message Storage:</strong> Direct messages travel peer-to-peer or via ephemeral socket relays and are never indexed or logged on server disks.</p>
                  <p>• <strong>WebRTC Video:</strong> Media streams are peer-to-peer encrypted between browsers.</p>
                  <p>• <strong>Anonymous Profiles:</strong> You use disposable nicknames and optional signal topics.</p>
                </>
              )}
              {legalModal === "terms" && (
                <>
                  <p className="font-semibold text-slate-900 dark:text-white">Terms of use summary.</p>
                  <p>By connecting to Quiet Signal, you agree to comply with our age limit (18+), maintain respectful conversation, and accept that sessions can be skipped or ended at any time by either party.</p>
                </>
              )}
            </div>

            <button
              onClick={() => setLegalModal(null)}
              className="w-full py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Report / Block Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-6 text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 mx-auto rounded-full bg-rose-50 dark:bg-rose-950/50 text-rose-500 flex items-center justify-center">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Report or Block {partner}?</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">This will immediately disconnect the session and block this stranger from matching with you again.</p>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowReportModal(false)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowReportModal(false);
                  setShowToast(`${partner} was blocked.`);
                  next();
                }}
                className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md shadow-rose-600/20"
              >
                Block & Skip
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Friend Requests Modal */}
      {showReviewRequestsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <span className="text-lg">👥</span>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Friend Requests</h3>
              </div>
              <button
                onClick={() => setShowReviewRequestsModal(false)}
                className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center justify-center text-xs"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2.5">
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {renderAvatar("River", "w-10 h-10")}
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">River</h4>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Matched on Music · Active now</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowToast("Accepted River's friend request! 💜");
                    setFriendRequestsCount((c) => Math.max(0, c - 1));
                  }}
                  className="px-3 py-1.5 rounded-xl bg-[#5b4df2] hover:bg-[#4d3fe0] text-white text-xs font-semibold transition-all cursor-pointer shadow-xs"
                >
                  Accept
                </button>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {renderAvatar("Atlas", "w-10 h-10")}
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">Atlas</h4>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Matched on Travel · Monday</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowToast("Accepted Atlas's friend request! 💜");
                    setFriendRequestsCount((c) => Math.max(0, c - 1));
                  }}
                  className="px-3 py-1.5 rounded-xl bg-[#5b4df2] hover:bg-[#4d3fe0] text-white text-xs font-semibold transition-all cursor-pointer shadow-xs"
                >
                  Accept
                </button>
              </div>
            </div>

            <button
              onClick={() => setShowReviewRequestsModal(false)}
              className="w-full py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ========================================================
          1. SETUP / WELCOME BOARD PHASE (Image 1 Refined)
          Desktop & Mobile with strict accessibility & trust
      ======================================================== */}
      {phase === "setup" && (
        <div className="flex-1 flex flex-col h-full overflow-y-auto bg-white dark:bg-[#0b0f19]">
          {/* Header on Setup: Clean branding ONLY, NO history/friends, plus Dark Mode toggle */}
          <header className="px-6 md:px-10 py-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 sticky top-0 bg-white/90 dark:bg-[#0b0f19]/90 backdrop-blur-md z-20">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[#5b4df2] flex items-center justify-center text-white shadow-xs">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <div>
                <h1 className="text-sm font-bold text-slate-900 dark:text-white leading-tight">Quiet Signal</h1>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-tight hidden sm:block">
                  Anonymous conversations, on your terms
                </p>
              </div>
            </div>

            {/* Dark mode toggle */}
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <span>{onlineCount.toLocaleString()} online</span>
              </span>

              <button
                type="button"
                onClick={toggleTheme}
                aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
                className="w-9 h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center transition-colors cursor-pointer"
                title={isDarkMode ? "Light mode" : "Dark mode"}
              >
                {isDarkMode ? "☀️" : "🌙"}
              </button>
            </div>
          </header>

          {/* Main Welcome Container - Max Width 1200px */}
          <main className="flex-1 flex flex-col justify-between p-4 sm:p-6 md:p-10 lg:p-12 max-w-[1200px] mx-auto w-full">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start pt-2 md:pt-4">
              
              {/* Left Column: Top-aligned Hero, tangible chat preview, trust badges */}
              <div className="lg:col-span-6 space-y-6">
                {/* Status Badges */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/80 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span>Private matching active</span>
                  </div>

                  <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-bold">
                    🔞 18+ only
                  </span>
                </div>

                {/* Headline & Subhead with WCAG AA compliant contrast */}
                <div className="space-y-3">
                  <h2 className="text-3xl sm:text-4xl lg:text-[42px] font-black text-slate-900 dark:text-white tracking-tight leading-[1.15]">
                    Meet someone new, without the pressure.
                  </h2>
                  <p className="text-slate-600 dark:text-slate-300 text-sm sm:text-base leading-relaxed">
                    Choose a few signals and we&apos;ll introduce you to someone who wants the same kind of conversation. No profiles, no pressure, leave whenever.
                  </p>
                </div>

                {/* Soft First Conversation Preview (fills dead space & makes app tangible) */}
                <div className="hidden sm:block p-4 sm:p-5 rounded-3xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800 space-y-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center justify-between">
                    <span>What a first chat looks like</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold lowercase">matched on music</span>
                  </div>

                  {/* Bubble 1: Stranger */}
                  <div className="flex items-start gap-2.5">
                    {renderAvatar("River", "w-7 h-7 text-xs")}
                    <div className="bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs px-3.5 py-2 rounded-2xl rounded-tl-xs shadow-2xs max-w-[85%]">
                      Hey there! What kind of music are you listening to tonight?
                    </div>
                  </div>

                  {/* Bubble 2: You */}
                  <div className="flex items-end justify-end gap-2.5">
                    <div className="bg-[#5b4df2] text-white text-xs px-3.5 py-2 rounded-2xl rounded-tr-xs shadow-2xs max-w-[85%]">
                      A lot of mellow indie. Trying to build a rainy-day playlist 🌧️
                    </div>
                  </div>

                  {/* Bubble 3: Stranger */}
                  <div className="flex items-start gap-2.5">
                    {renderAvatar("River", "w-7 h-7 text-xs")}
                    <div className="bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs px-3.5 py-2 rounded-2xl rounded-tl-xs shadow-2xs max-w-[85%]">
                      Indie folk is the best for that. Have you heard the new Fleet Foxes?
                    </div>
                  </div>
                </div>

                {/* Trust and Safety Commitments */}
                <div className="space-y-3 pt-1">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-700 dark:text-slate-300 font-medium">
                    <div className="flex items-center gap-2 p-2.5 rounded-2xl bg-white dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/60">
                      <svg className="w-4 h-4 text-[#5b4df2] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      <span>Anonymous by default</span>
                    </div>

                    <div className="flex items-center gap-2 p-2.5 rounded-2xl bg-white dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/60">
                      <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span>Leave anytime (1-click skip)</span>
                    </div>

                    <div className="flex items-center gap-2 p-2.5 rounded-2xl bg-white dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/60">
                      <span className="text-sm">🛡️</span>
                      <span>Active moderation & block</span>
                    </div>

                    <div className="flex items-center gap-2 p-2.5 rounded-2xl bg-white dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/60">
                      <span className="text-sm">🗑️</span>
                      <span>Zero message storage</span>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed px-1">
                    🔒 Messages are never saved on our disks and vanish when disconnected. Mutual consent is strictly required for audio/video.
                  </p>
                </div>
              </div>

              {/* Right Column: "Set your signal" Card (Desktop unified / Mobile 3-step wizard) */}
              <div className="lg:col-span-6">
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-6 sm:p-8 shadow-[0_12px_40px_-15px_rgba(0,0,0,0.07)] dark:shadow-none space-y-6">
                  
                  {/* Card Title & Surprise Me button */}
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">Set your signal</h3>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">Only share what helps us match you.</p>
                    </div>

                    {/* Sparkle "Surprise me" action button */}
                    <button
                      type="button"
                      onClick={surpriseTopics}
                      className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-[#5b4df2] dark:text-indigo-400 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Surprise me: pick random topics"
                      aria-label="Surprise me with random topics"
                    >
                      <span>✦</span>
                      <span>Surprise me</span>
                    </button>
                  </div>

                  {/* Mobile Stepper Indicator (shown only on mobile screens < md) */}
                  <div className="block md:hidden pb-1">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
                      <span>Step {mobileStep} of 3: {mobileStep === 1 ? "Identity" : mobileStep === 2 ? "Topics" : "Style"}</span>
                      <span className="text-[11px] text-[#5b4df2]">{Math.round((mobileStep / 3) * 100)}%</span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-[#5b4df2] h-full transition-all duration-300"
                        style={{ width: `${(mobileStep / 3) * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Step 1: Nickname (Visible always on desktop, on step 1 on mobile) */}
                  <div className={`space-y-2 ${mobileStep !== 1 ? "hidden md:block" : ""}`}>
                    <div className="flex items-center justify-between">
                      <label htmlFor="nickname-input" className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                        How should we call you?
                      </label>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">Not your real name</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        id="nickname-input"
                        type="text"
                        className="flex-1 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/80 text-base text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#5b4df2] focus:bg-white dark:focus:bg-slate-800 transition-all min-h-[44px]"
                        placeholder="e.g. Clover"
                        value={nick}
                        maxLength={20}
                        onChange={(e) => setNick(e.target.value)}
                      />

                      {/* Shuffle Button for anonymous name */}
                      <button
                        type="button"
                        onClick={shuffleNickname}
                        className="px-3.5 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer min-h-[44px]"
                        title="Shuffle random anonymous name"
                        aria-label="Shuffle anonymous name"
                      >
                        <span>🎲</span>
                        <span className="hidden sm:inline">Shuffle</span>
                      </button>
                    </div>

                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Anonymous handle visible only to your conversation partner during the chat.
                    </p>

                    {/* Mobile Step 1 Next Button */}
                    <div className="block md:hidden pt-2">
                      <button
                        type="button"
                        onClick={() => setMobileStep(2)}
                        className="w-full py-3.5 px-4 rounded-xl bg-[#5b4df2] text-white font-semibold text-sm shadow-md transition-all min-h-[44px] flex items-center justify-center gap-2"
                      >
                        <span>Next: Pick Topics</span>
                        <span>→</span>
                      </button>
                    </div>
                  </div>

                  {/* Step 2: Topics Selection (Visible always on desktop, on step 2 on mobile) */}
                  <div className={`space-y-2.5 ${mobileStep !== 2 ? "hidden md:block" : ""}`}>
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                        I&apos;m open to talking about <span className="text-slate-500 dark:text-slate-400 font-normal">(Pick up to 5)</span>
                      </label>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        selectedTopics.length === 5
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                      }`}>
                        {selectedTopics.length} / 5
                      </span>
                    </div>

                    {/* Chips grid with 44px touch targets and ARIA states */}
                    <div className="flex flex-wrap gap-2 pt-1" role="group" aria-label="Conversation topics">
                      {PRESET_TOPICS.map((topic) => {
                        const isSelected = selectedTopics.includes(topic);
                        return (
                          <button
                            key={topic}
                            type="button"
                            role="button"
                            aria-pressed={isSelected}
                            onClick={() => toggleTopic(topic)}
                            className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-[#5b4df2] focus-visible:outline-none active:scale-95 motion-reduce:transform-none ${
                              isSelected
                                ? "bg-[#5b4df2] text-white shadow-xs shadow-[#5b4df2]/30"
                                : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-transparent"
                            }`}
                          >
                            <span>{topic}</span>
                            {isSelected && <span className="text-[10px] opacity-80">✓</span>}
                          </button>
                        );
                      })}
                    </div>

                    {/* Add Custom Topic Input */}
                    <div className="pt-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Add custom topic (e.g. Photography, Anime)..."
                          className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-base md:text-xs bg-slate-50/50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#5b4df2] min-h-[44px]"
                          value={customTopic}
                          maxLength={24}
                          disabled={selectedTopics.length >= 5}
                          onChange={(e) => {
                            setCustomTopic(e.target.value);
                            setTopicInputError(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addCustomTopic();
                            }
                          }}
                        />
                        <button
                          type="button"
                          disabled={!customTopic.trim() || selectedTopics.length >= 5}
                          onClick={addCustomTopic}
                          className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 text-xs font-semibold transition-colors cursor-pointer min-h-[44px]"
                        >
                          + Add
                        </button>
                      </div>

                      {topicInputError && (
                        <p className="text-[11px] text-rose-500 font-medium px-1">
                          {topicInputError}
                        </p>
                      )}
                    </div>

                    {/* Mobile Step 2 Navigation Buttons */}
                    <div className="flex md:hidden items-center gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setMobileStep(1)}
                        className="py-3 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs min-h-[44px]"
                      >
                        ← Back
                      </button>
                      <button
                        type="button"
                        onClick={() => setMobileStep(3)}
                        className="flex-1 py-3 px-4 rounded-xl bg-[#5b4df2] text-white font-semibold text-xs min-h-[44px] flex items-center justify-center gap-1.5"
                      >
                        <span>Next: Style</span>
                        <span>→</span>
                      </button>
                    </div>
                  </div>

                  {/* Step 3: Conversation Style (Visible always on desktop, on step 3 on mobile) */}
                  <div className={`space-y-2.5 ${mobileStep !== 3 ? "hidden md:block" : ""}`}>
                    <label className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                      Conversation style
                    </label>

                    {/* Accessible Radiogroup */}
                    <div
                      role="radiogroup"
                      aria-label="Conversation style"
                      className="grid grid-cols-2 gap-3"
                    >
                      {/* Text First */}
                      <div
                        role="radio"
                        aria-checked={conversationStyle === "text"}
                        tabIndex={0}
                        onClick={() => setConversationStyle("text")}
                        onKeyDown={(e) => (e.key === " " || e.key === "Enter") && setConversationStyle("text")}
                        className={`p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between min-h-[88px] focus-visible:ring-2 focus-visible:ring-[#5b4df2] focus-visible:outline-none ${
                          conversationStyle === "text"
                            ? "border-[#5b4df2] bg-indigo-50/50 dark:bg-indigo-950/40 ring-1 ring-[#5b4df2]"
                            : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-800/60"
                        }`}
                      >
                        <div className="w-8 h-8 rounded-xl bg-[#5b4df2]/10 text-[#5b4df2] flex items-center justify-center mb-2">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                          </svg>
                        </div>
                        <div>
                          <div className="text-xs font-bold text-slate-900 dark:text-white">Text first</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">Ease into it</div>
                        </div>
                      </div>

                      {/* Open to Video */}
                      <div
                        role="radio"
                        aria-checked={conversationStyle === "video"}
                        tabIndex={0}
                        onClick={() => setConversationStyle("video")}
                        onKeyDown={(e) => (e.key === " " || e.key === "Enter") && setConversationStyle("video")}
                        className={`p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between min-h-[88px] focus-visible:ring-2 focus-visible:ring-[#5b4df2] focus-visible:outline-none ${
                          conversationStyle === "video"
                            ? "border-[#5b4df2] bg-indigo-50/50 dark:bg-indigo-950/40 ring-1 ring-[#5b4df2]"
                            : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-800/60"
                        }`}
                      >
                        <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center mb-2">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                          </svg>
                        </div>
                        <div>
                          <div className="text-xs font-bold text-slate-900 dark:text-white">Open to video</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">When it feels right</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Primary CTA Area with expectation setting */}
                  <div className={`space-y-3 pt-2 ${mobileStep !== 3 ? "hidden md:block" : ""}`}>
                    {/* Expectation text */}
                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 px-1">
                      <span className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        <span>Avg match: under 45s</span>
                      </span>
                      <span>{onlineCount.toLocaleString()} people online</span>
                    </div>

                    {/* Mobile Back button if on Step 3 */}
                    <div className="flex items-center gap-2">
                      {mobileStep === 3 && (
                        <button
                          type="button"
                          onClick={() => setMobileStep(2)}
                          className="md:hidden py-3.5 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs min-h-[44px]"
                        >
                          ←
                        </button>
                      )}

                      <button
                        onClick={find}
                        className="flex-1 py-3.5 px-4 rounded-xl bg-[#5b4df2] hover:bg-[#4d3fe0] text-white font-semibold text-sm tracking-wide shadow-md shadow-[#5b4df2]/25 transition-all cursor-pointer flex items-center justify-center gap-2 min-h-[44px] active:scale-[0.98]"
                      >
                        <span>Find my conversation</span>
                        <span className="text-base font-bold">→</span>
                      </button>
                    </div>

                    {/* Mobile trust badges row under CTA */}
                    <div className="block md:hidden text-center pt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      <span>Anonymous · 18+ · Leave anytime</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Links with WCAG compliant text and dialog triggers */}
            <footer className="mt-12 pt-6 border-t border-slate-200/80 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span>© 2026 Quiet Signal</span>
                <span>·</span>
                <span>Encrypted stranger chat</span>
              </div>

              <div className="flex items-center gap-6">
                <button
                  type="button"
                  onClick={() => setLegalModal("guidelines")}
                  className="hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                >
                  Guidelines
                </button>
                <button
                  type="button"
                  onClick={() => setLegalModal("privacy")}
                  className="hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                >
                  Privacy
                </button>
                <button
                  type="button"
                  onClick={() => setLegalModal("terms")}
                  className="hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                >
                  Terms
                </button>
                <button
                  type="button"
                  onClick={() => setShowSafetyModal(true)}
                  className="text-[#5b4df2] hover:underline font-semibold cursor-pointer"
                >
                  Safety Center
                </button>
              </div>
            </footer>
          </main>
        </div>
      )}

      {/* ========================================================
          2. WAITING / POST-CLICK MATCHING PHASE
      ======================================================== */}
      {phase === "waiting" && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 bg-white dark:bg-[#0b0f19]">
          <div className="w-full max-w-sm rounded-3xl border border-slate-200 dark:border-slate-800 p-8 text-center space-y-6 shadow-sm bg-slate-50/50 dark:bg-slate-900">
            {/* Animated radar/pulsing matching graphic */}
            <div className="relative w-24 h-24 mx-auto flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-4 border-[#5b4df2]/20 animate-ping"></div>
              <div className="absolute inset-2 rounded-full border-2 border-indigo-400/30 animate-pulse"></div>
              <div className="w-20 h-20 rounded-full border-4 border-t-[#5b4df2] border-r-[#5b4df2] border-b-transparent border-l-transparent animate-spin flex items-center justify-center">
                <div className="w-12 h-12 rounded-full bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center text-[#5b4df2] font-bold text-lg">
                  ✦
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Finding someone…</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Searching for partners with signals: <span className="text-[#5b4df2] font-semibold">{selectedTopics.join(", ")}</span>
              </p>
              <div className="text-[11px] text-slate-400 font-mono pt-1">
                Elapsed: {formatTimer(searchElapsedSeconds)}
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
              ⚡ Matching with another {conversationStyle === "video" ? "video-ready" : "text"} chatter
            </div>

            <button
              onClick={stop}
              className="w-full py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel search
            </button>
          </div>
        </div>
      )}

      {/* ========================================================
          3. FULL CONVERSATION HISTORY & CONNECTIONS VIEW
      ======================================================== */}
      {phase === "history" && (
        <div className="flex-1 flex flex-col h-full bg-[#f8fafc] dark:bg-[#0b0f19] overflow-y-auto">
          {/* Header */}
          <header className="px-6 md:px-8 py-4.5 bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setPhase("setup")}
                className="w-8 h-8 rounded-xl bg-[#5b4df2] flex items-center justify-center text-white shadow-xs cursor-pointer"
                title="Home"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </button>
              <div>
                <h1 className="text-sm font-bold text-slate-900 dark:text-white leading-tight">Your conversations</h1>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">The people you met on Quiet Signal</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggleTheme}
                className="w-8 h-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs flex items-center justify-center"
              >
                {isDarkMode ? "☀️" : "🌙"}
              </button>

              <button
                onClick={() => setPhase("setup")}
                className="px-4 py-2 rounded-xl bg-[#5b4df2] hover:bg-[#4d3fe0] text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
              >
                New match
              </button>
            </div>
          </header>

          {/* Main 2-column history & connections layout */}
          <main className="flex-1 p-4 sm:p-8 max-w-6xl mx-auto w-full">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Left Column: Recent Conversations */}
              <div className="lg:col-span-8 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Recent conversations</h3>
                  <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                    </svg>
                    <span>Filter</span>
                  </button>
                </div>

                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {historyList.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => {
                        setPartner(item.partner_name);
                        setPhase("chat");
                      }}
                      className="py-4 flex items-center justify-between hover:bg-slate-50/80 dark:hover:bg-slate-800/50 -mx-3 px-3 rounded-2xl transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-3.5">
                        {renderAvatar(item.partner_name, "w-11 h-11")}
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-900 dark:text-white">{item.partner_name}</span>
                            {item.common_interests && item.common_interests.length > 0 && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950 text-[#5b4df2] dark:text-indigo-400 font-semibold">
                                {item.common_interests[0]}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1 max-w-md">
                            {item.last_message || "Thanks for the great conversation!"}
                          </p>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-[11px] text-slate-400">
                          {item.id === "hist-1" ? "Active now" : item.id === "hist-2" ? "Monday" : "Oct 14"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Column: Connections & Cards */}
              <div className="lg:col-span-4 space-y-5">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white px-1">Connections</h3>

                {/* Friend Requests Card */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-xs space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                      👥
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                        {friendRequestsCount} friend requests
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">From conversations you enjoyed</p>
                    </div>
                  </div>

                  <button
                    onClick={() => setShowReviewRequestsModal(true)}
                    className="w-full py-2.5 px-4 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-[#5b4df2] dark:text-indigo-400 text-xs font-semibold transition-all cursor-pointer"
                  >
                    Review requests
                  </button>
                </div>

                {/* Privacy Assurance Card */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-xs space-y-2">
                  <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white">Conversations stay yours</h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    You can remove any chat or connection whenever you like.
                  </p>
                </div>

                {/* Friends List Box */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-xs space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">Your Friends</h4>
                    <span className="text-[10px] text-slate-400 font-medium">{friendsList.length} total</span>
                  </div>

                  <div className="space-y-2">
                    {friendsList.map((f) => (
                      <div key={f.id} className="flex items-center justify-between py-1">
                        <div className="flex items-center gap-2.5">
                          {renderAvatar(f.friend_name, "w-7 h-7 text-xs")}
                          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">{f.friend_name}</span>
                        </div>
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full font-medium">
                          Connected
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>
      )}

      {/* ========================================================
          4. VIDEO CALL STATE
      ======================================================== */}
      {(phase === "chat" || phase === "ended") && isVideoActive && (
        <div className="flex-1 flex flex-col h-full bg-[#0d1017] text-white">
          {/* Top Bar Video */}
          <header className="px-6 py-4 flex items-center justify-between border-b border-white/10 bg-[#0d1017]">
            <div className="flex items-center gap-3">
              <button
                onClick={stopVideo}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-300 transition-colors"
                title="Back to text"
              >
                ←
              </button>
              <div>
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  <span>Video with {partner}</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  <span className="text-slate-400 font-normal">Encrypted call - {formatTimer(callDurationSeconds)}</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowSafetyModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span>Safety</span>
            </button>
          </header>

          {/* Main Video Area */}
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden p-4 gap-4">
            <div className="relative flex-1 bg-[#141824] rounded-3xl overflow-hidden flex items-center justify-center border border-white/10">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />

              {!remoteHasVideo && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#141824] space-y-3">
                  <div className="relative w-24 h-24">
                    {renderAvatar(partner, "w-24 h-24 text-3xl")}
                  </div>
                  <div className="text-center">
                    <h3 className="text-sm font-bold text-white">{partner}</h3>
                    <p className="text-[11px] text-slate-400">{partnerLocation}</p>
                  </div>
                </div>
              )}

              {/* Floating Self Camera */}
              <div className="absolute top-4 right-4 w-36 h-28 sm:w-44 sm:h-32 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl bg-[#0b0e14] z-20">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover -scale-x-100 ${
                    isCamOff || !hasLocalMedia ? "hidden" : ""
                  }`}
                />
                {(isCamOff || !hasLocalMedia) && (
                  <div className="w-full h-full flex flex-col items-center justify-center text-[10px] text-slate-400 p-2 text-center">
                    {renderAvatar(nick || "You", "w-8 h-8 text-xs mb-1")}
                    <span>{isCamOff ? "Camera Off" : "No Camera"}</span>
                  </div>
                )}
              </div>

              {/* Status Pill: Recording is off */}
              <div className="absolute bottom-5 left-5 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[11px] font-medium text-slate-300">
                <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                <span>Recording is off</span>
              </div>

              {/* Floating Video Controls Dock */}
              <div className="absolute bottom-5 inset-x-0 mx-auto w-fit flex items-center gap-3 px-4 py-2.5 rounded-full bg-black/70 backdrop-blur-lg border border-white/15 shadow-2xl z-20">
                <button
                  onClick={toggleMic}
                  title={isMicMuted ? "Unmute" : "Mute"}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                    isMicMuted
                      ? "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                      : "bg-white/15 text-white hover:bg-white/25"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    {isMicMuted ? (
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 19L5 5m9.5 9.5A4 4 0 0016 11V5a4 4 0 00-8 0v2m2 7a4 4 0 01-11.83 5M12 19v3m-4 0h8" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0m7 7v4m-4 0h8m-4-15a3 3 0 00-3 3v4a3 3 0 006 0V7a3 3 0 00-3-3z" />
                    )}
                  </svg>
                </button>

                <button
                  onClick={toggleCam}
                  title={isCamOff ? "Start Camera" : "Stop Camera"}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                    isCamOff
                      ? "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                      : "bg-white/15 text-white hover:bg-white/25"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>

                <button
                  onClick={() => setShowChatInVideo(!showChatInVideo)}
                  title="Toggle Chat"
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                    showChatInVideo ? "bg-[#5b4df2] text-white" : "bg-white/15 text-white hover:bg-white/25"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </button>

                <button
                  onClick={stopVideo}
                  className="px-4 py-2 rounded-full bg-[#eb5757] hover:bg-rose-600 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-rose-600/30 cursor-pointer"
                >
                  <span>Leave call</span>
                </button>

                <button
                  onClick={next}
                  className="px-4 py-2 rounded-full bg-[#5b4df2] hover:bg-[#4d3fe0] text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-[#5b4df2]/30 cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>Next stranger</span>
                </button>
              </div>
            </div>

            {/* Video Right Sidebar */}
            <div className="w-full lg:w-80 space-y-4">
              <div className="bg-[#141824] rounded-3xl p-5 border border-white/10 space-y-3">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Shared Signal
                </span>
                <div className="text-xs font-bold text-white">{common[0] || "Music"}</div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  You both picked {common[0] || "Music"} as a conversation starter.
                </p>
              </div>

              <div className="bg-[#141824] rounded-3xl p-5 border border-white/10 space-y-3 text-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Call Comfort
                </span>
                <div className="space-y-2 text-[11px] text-slate-300">
                  <div className="flex items-center gap-2">
                    <span>👁️</span>
                    <span>Hide your video anytime</span>
                  </div>
                  <div className="flex items-center gap-2 cursor-pointer hover:text-rose-400" onClick={() => setShowReportModal(true)}>
                    <span>🚩</span>
                    <span>Report without ending</span>
                  </div>
                </div>
              </div>

              {/* Friend Button */}
              {friendStatus === "none" && (
                <button
                  onClick={sendFriendRequest}
                  className="w-full py-3 rounded-2xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>+ Add as friend</span>
                </button>
              )}
              {friendStatus === "sent" && (
                <div className="w-full py-3 rounded-2xl bg-white/5 text-slate-400 text-xs font-medium text-center">
                  Request Sent
                </div>
              )}
              {friendStatus === "received" && (
                <button
                  onClick={acceptFriendRequest}
                  className="w-full py-3 rounded-2xl bg-[#5b4df2] hover:bg-[#4d3fe0] text-white text-xs font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  Accept Friend Request
                </button>
              )}
              {friendStatus === "friends" && (
                <div className="w-full py-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-semibold text-center flex items-center justify-center gap-1.5">
                  <span>✓</span> Friends
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          5. ACTIVE STRANGER CHAT & RESPONSIVE MOBILE VIEW
      ======================================================== */}
      {(phase === "chat" || phase === "ended") && !isVideoActive && (
        <div className="flex-1 flex flex-col h-full bg-[#f8fafc] dark:bg-[#0b0f19] overflow-hidden">
          {/* Top Navbar */}
          <header className="h-16 px-6 bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between shrink-0">
            {/* Left: Brand */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setPhase("history")}
                className="w-8 h-8 rounded-xl bg-[#5b4df2] flex items-center justify-center text-white shadow-xs cursor-pointer"
                title="View conversations"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </button>
              <div>
                <h1 className="text-sm font-bold text-slate-900 dark:text-white leading-tight">Quiet Signal</h1>
              </div>
            </div>

            {/* Right: Anonymous chat badge + History & End session */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggleTheme}
                className="w-8 h-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs flex items-center justify-center"
              >
                {isDarkMode ? "☀️" : "🌙"}
              </button>

              <button
                onClick={() => setPhase("history")}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <span>🕒</span>
                <span>History</span>
              </button>

              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium hidden md:inline">Anonymous chat</span>

              <button
                onClick={stop}
                className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
              >
                End session
              </button>
            </div>
          </header>

          {/* Main 3-Column Viewport */}
          <div className="flex-1 flex overflow-hidden">
            {/* 1. Left Sidebar: Recent Chats */}
            <aside className="w-72 bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-800 hidden md:flex flex-col justify-between shrink-0">
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white">Recent chats</h3>
                  <button
                    onClick={() => setPhase("history")}
                    className="w-6 h-6 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-700 text-xs cursor-pointer"
                    title="View history"
                  >
                    🕒
                  </button>
                </div>

                <div className="space-y-1">
                  {/* Current Active */}
                  <div className="p-3 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100/80 dark:border-indigo-900/50 flex items-center gap-3">
                    {renderAvatar(partner, "w-9 h-9")}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-900 dark:text-white truncate">{partner}</span>
                        <span className="text-[10px] text-[#5b4df2] font-semibold">Now</span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {msgs.length > 0 ? msgs[msgs.length - 1].text : "I've been trying to learn guitar..."}
                      </p>
                    </div>
                  </div>

                  {/* Other recent chats */}
                  <div
                    onClick={() => setPhase("history")}
                    className="p-3 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-center gap-3 cursor-pointer"
                  >
                    {renderAvatar("Sunny", "w-9 h-9")}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">Sunny</span>
                        <span className="text-[10px] text-slate-400">Yesterday</span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">That book is on my list too.</p>
                    </div>
                  </div>

                  <div
                    onClick={() => setPhase("history")}
                    className="p-3 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-center gap-3 cursor-pointer"
                  >
                    {renderAvatar("Atlas", "w-9 h-9")}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">Atlas</span>
                        <span className="text-[10px] text-slate-400">Mon</span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">Thanks for the travel tips!</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Card: Safety Matters */}
              <div className="p-4 border-t border-slate-100 dark:border-slate-800">
                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 space-y-1">
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white">Your safety matters</h4>
                  <button
                    onClick={() => setShowSafetyModal(true)}
                    className="text-[11px] text-[#5b4df2] dark:text-indigo-400 font-semibold hover:underline cursor-pointer block"
                  >
                    Safety guide
                  </button>
                </div>
              </div>
            </aside>

            {/* 2. Center Column: Chat Conversation Stream */}
            <main className="flex-1 flex flex-col bg-white dark:bg-slate-900 overflow-hidden border-r border-slate-200/80 dark:border-slate-800">
              {/* Partner Info Top Bar */}
              <div className="h-16 px-4 md:px-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900 shrink-0">
                <div className="flex items-center gap-3">
                  <button
                    onClick={stop}
                    className="md:hidden w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center font-bold text-xs"
                  >
                    ←
                  </button>
                  {renderAvatar(partner, "w-10 h-10")}
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white leading-tight">{partner}</h2>
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                      Matched on {common[0] || "Music"} · Here now
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!outgoingCallWaiting ? (
                    <button
                      onClick={requestVideoCall}
                      className="w-9 h-9 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-[#5b4df2] dark:text-indigo-400 flex items-center justify-center transition-colors cursor-pointer"
                      title="Start Video Call"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                      </svg>
                    </button>
                  ) : (
                    <button
                      onClick={cancelCallRequest}
                      className="px-3 py-1 rounded-xl bg-amber-50 text-amber-700 text-xs font-semibold animate-pulse"
                    >
                      Calling… (Cancel)
                    </button>
                  )}

                  <button
                    onClick={() => setShowReportModal(true)}
                    className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center transition-colors cursor-pointer text-sm font-bold"
                  >
                    •••
                  </button>
                </div>
              </div>

              {/* Chat Message Feed */}
              <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-4 bg-[#fafafa] dark:bg-[#0b0f19]">
                <div className="text-center my-3">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 px-3.5 py-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs font-medium">
                    Matched on {common[0] || "Music"}
                  </span>
                </div>

                {msgs.map((m, i) => (
                  <div key={i} className={`flex items-end gap-2 ${m.mine ? "justify-end" : "justify-start"}`}>
                    {!m.mine && renderAvatar(partner, "w-7 h-7 text-xs")}
                    <div className="flex flex-col space-y-1 max-w-[80%] sm:max-w-md">
                      {!m.mine && (
                        <span className="text-[10px] text-slate-400 font-semibold px-1">{partner}</span>
                      )}
                      <div
                        className={`px-4 py-2.5 rounded-2xl text-xs sm:text-sm leading-relaxed break-words shadow-2xs ${
                          m.mine
                            ? "bg-[#5b4df2] text-white rounded-tr-xs"
                            : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700 rounded-tl-xs"
                        }`}
                      >
                        {m.text}
                      </div>
                      {m.mine && (
                        <div className="text-right px-1">
                          <span className="text-[10px] text-slate-400">Seen</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {phase === "ended" && (
                  <div className="text-center py-6 space-y-2">
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                      {partner || "Stranger"} has disconnected.
                    </p>
                    <button
                      onClick={next}
                      className="px-4 py-2 rounded-xl bg-[#5b4df2] hover:bg-[#4d3fe0] text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
                    >
                      Find next stranger
                    </button>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Input Area + Mobile Action Bar */}
              <div className="p-3 sm:p-4 bg-white dark:bg-slate-900 border-t border-slate-200/80 dark:border-slate-800 space-y-3">
                <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 rounded-2xl px-3 py-2 border border-slate-200 dark:border-slate-700 focus-within:border-[#5b4df2] focus-within:bg-white dark:focus-within:bg-slate-800 transition-all">
                  <button className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors px-1 text-lg">
                    +
                  </button>

                  <input
                    type="text"
                    className="flex-1 bg-transparent text-base sm:text-sm text-slate-800 dark:text-white placeholder-slate-400 outline-none"
                    placeholder={`Write a message to ${partner}…`}
                    disabled={phase === "ended"}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && send()}
                  />

                  <button
                    onClick={send}
                    disabled={phase === "ended" || !draft.trim()}
                    className="w-8 h-8 rounded-full bg-[#5b4df2] hover:bg-[#4d3fe0] disabled:opacity-30 disabled:hover:bg-[#5b4df2] text-white flex items-center justify-center transition-all cursor-pointer shadow-xs"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </button>
                </div>

                {/* Mobile View Action Buttons Row */}
                <div className="flex md:hidden items-center justify-between gap-2 pt-1">
                  {friendStatus === "none" && (
                    <button
                      onClick={sendFriendRequest}
                      className="flex-1 py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors min-h-[44px]"
                    >
                      <span>+</span>
                      <span>Friend</span>
                    </button>
                  )}
                  {friendStatus === "sent" && (
                    <div className="flex-1 py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 text-xs font-medium text-center min-h-[44px] flex items-center justify-center">
                      Sent
                    </div>
                  )}
                  {friendStatus === "received" && (
                    <button
                      onClick={acceptFriendRequest}
                      className="flex-1 py-2.5 px-3 rounded-xl bg-[#5b4df2] text-white text-xs font-semibold flex items-center justify-center gap-1.5 min-h-[44px]"
                    >
                      Accept
                    </button>
                  )}
                  {friendStatus === "friends" && (
                    <div className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-xs font-semibold text-center min-h-[44px] flex items-center justify-center">
                      ✓ Friends
                    </div>
                  )}

                  <button
                    onClick={() => setShowSafetyModal(true)}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors min-h-[44px]"
                  >
                    <span>🛡</span>
                    <span>Safety</span>
                  </button>

                  <button
                    onClick={next}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-[#eb5757] hover:bg-rose-600 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer min-h-[44px]"
                  >
                    <span>🔄</span>
                    <span>Skip</span>
                  </button>
                </div>
              </div>
            </main>

            {/* 3. Right Sidebar: Stranger Profile & Actions */}
            <aside className="w-80 bg-white dark:bg-slate-900 p-6 hidden lg:flex flex-col justify-between shrink-0">
              <div className="space-y-6">
                <div className="text-center space-y-2">
                  <div className="w-20 h-20 mx-auto">
                    {renderAvatar(partner, "w-20 h-20 text-3xl")}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">{partner}</h3>
                    <p className="text-[11px] text-slate-400">{partnerLocation}</p>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/50 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Shared Signal
                  </span>
                  <div className="text-xs font-bold text-slate-900 dark:text-white">
                    {common[0] || "Music"} - Indie & folk
                  </div>
                </div>

                <div className="space-y-2.5">
                  {friendStatus === "none" && (
                    <button
                      onClick={sendFriendRequest}
                      className="w-full py-2.5 px-4 rounded-xl bg-[#5b4df2] hover:bg-[#4d3fe0] text-white text-xs font-semibold shadow-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 min-h-[44px]"
                    >
                      <span>+</span> Add as friend
                    </button>
                  )}
                  {friendStatus === "sent" && (
                    <div className="w-full py-2.5 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 text-xs font-semibold text-center min-h-[44px] flex items-center justify-center">
                      Request Sent
                    </div>
                  )}
                  {friendStatus === "received" && (
                    <button
                      onClick={acceptFriendRequest}
                      className="w-full py-2.5 px-4 rounded-xl bg-[#5b4df2] hover:bg-[#4d3fe0] text-white text-xs font-semibold transition-all cursor-pointer min-h-[44px]"
                    >
                      Accept Friend Request
                    </button>
                  )}
                  {friendStatus === "friends" && (
                    <div className="w-full py-2.5 px-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-semibold text-center flex items-center justify-center gap-1 min-h-[44px]">
                      <span>✓</span> Friends
                    </div>
                  )}

                  <button
                    onClick={() => setShowReportModal(true)}
                    className="w-full py-2.5 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5 min-h-[44px]"
                  >
                    <span>🛡</span> Report or block
                  </button>
                </div>
              </div>

              <button
                onClick={next}
                className="w-full py-3 px-4 rounded-xl bg-[#eb5757] hover:bg-rose-600 text-white text-xs font-semibold transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer min-h-[44px]"
              >
                <span>🔄</span>
                <span>Skip to next stranger</span>
              </button>
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}
