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
import {
  AuthMember,
  getStoredMember,
  saveStoredMember,
  clearStoredMember,
  sendMagicLinkOrCode,
  verifyEmailCode,
  signInOAuth,
  logoutMember,
} from "./lib/auth";
import {
  validateHandle,
  normalizeHandle,
  generateHandleSuggestions,
} from "./lib/handleRules";

type Phase = "setup" | "waiting" | "chat" | "ended" | "history";
type Gender = "male" | "female" | "other";
type ConversationStyle = "text" | "video";
type Msg = {
  mine: boolean;
  type?: "text" | "image" | "audio";
  text?: string;
  mediaUrl?: string;
  time: string;
};

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
  "Cooking",
  "Stargazing",
];

const BROAD_REGIONS = [
  "Pacific Northwest",
  "Mid-Atlantic",
  "Western Europe",
  "Great Lakes",
  "Northern California",
  "New England",
  "Central Europe",
  "East Coast",
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
  const callTimeoutTimerRef = useRef<NodeJS.Timeout | null>(null);
  const undoSkipTimerRef = useRef<NodeJS.Timeout | null>(null);

  // File upload & audio recording refs
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Dark mode state
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Welcome flow
  const [phase, setPhase] = useState<Phase>("setup");
  const [nick, setNick] = useState("Clover");
  const [selectedTopics, setSelectedTopics] = useState<string[]>(["Music", "Late-night thoughts"]);
  const [customTopic, setCustomTopic] = useState("");
  const [topicInputError, setTopicInputError] = useState<string | null>(null);
  const [conversationStyle, setConversationStyle] = useState<ConversationStyle>("text");
  const [gender, setGender] = useState<Gender>("other");
  const [isAgeConfirmed, setIsAgeConfirmed] = useState(true);

  // Mobile multi-step wizard state (Step 1: Identity, Step 2: Topics, Step 3: Style)
  const [mobileStep, setMobileStep] = useState<1 | 2 | 3>(1);

  // Searching elapsed time
  const [searchElapsedSeconds, setSearchElapsedSeconds] = useState(0);

  // Partner info
  const [partner, setPartner] = useState("Stranger");
  const [partnerGender, setPartnerGender] = useState<Gender>("female");
  const [partnerLocation, setPartnerLocation] = useState("Pacific Northwest");
  const [partnerStyle, setPartnerStyle] = useState<ConversationStyle>("text");
  const [common, setCommon] = useState<string[]>(["Music"]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [onlineCount, setOnlineCount] = useState(3842);

  // Image & Voice recording states
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null);

  // Skip undo banner state
  const [undoBanner, setUndoBanner] = useState<{ active: boolean; prevPartner: string } | null>(null);

  // Video call duration timer
  const callDurationSecondsRef = useRef<NodeJS.Timeout | null>(null);
  const [callDurationSeconds, setCallDurationSeconds] = useState(0);

  // Identity & Auth System (Guest vs Member)
  const [currentMember, setCurrentMember] = useState<AuthMember | null>(null);
  const [partnerIsMember, setPartnerIsMember] = useState(false);
  const [partnerHandle, setPartnerHandle] = useState<string | null>(null);

  // Auth & Claim Handle Modal states
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<"signin" | "claim">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authOtpCode, setAuthOtpCode] = useState("");
  const [authOtpSent, setAuthOtpSent] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccessMessage, setAuthSuccessMessage] = useState<string | null>(null);

  // Live handle availability checking states
  const [claimHandleInput, setClaimHandleInput] = useState("");
  const [claimHandleChecking, setClaimHandleChecking] = useState(false);
  const [claimHandleStatus, setClaimHandleStatus] = useState<{ available: boolean; reason?: string } | null>(null);
  const [claimHandleSuggestions, setClaimHandleSuggestions] = useState<string[]>([]);
  const checkHandleTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Supabase User & Data state (Real only, NO dummy data)
  const [userId, setUserId] = useState<string | null>(null);
  const [friendsList, setFriendsList] = useState<FriendItem[]>([]);
  const [historyList, setHistoryList] = useState<MatchHistoryItem[]>([]);
  const [showReviewRequestsModal, setShowReviewRequestsModal] = useState(false);
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportAttachEvidence, setReportAttachEvidence] = useState(true);
  const [reportReason, setReportReason] = useState("Inappropriate behavior");
  const [legalModal, setLegalModal] = useState<"guidelines" | "privacy" | "terms" | null>(null);

  // Mobile drawer & sheet states
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [mobileProfileOpen, setMobileProfileOpen] = useState(false);

  // Friend System states
  const [friendStatus, setFriendStatus] = useState<"none" | "sent" | "received" | "friends">("none");
  const [showToast, setShowToast] = useState<string | null>(null);

  // Video Call Request / Calling states
  const [outgoingCallWaiting, setOutgoingCallWaiting] = useState(false);
  const [callDeclinedMessage, setCallDeclinedMessage] = useState<string | null>(null);
  const [incomingCallRequest, setIncomingCallRequest] = useState<boolean>(false);
  const [incomingCountdown, setIncomingCountdown] = useState(25);
  const [previewCameraMuted, setPreviewCameraMuted] = useState(false);

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

  // Load real member session, friends, and history on mount
  useEffect(() => {
    const stored = getStoredMember();
    if (stored) {
      setCurrentMember(stored);
      if (stored.handle) {
        setNick(stored.handle);
      }
      setUserId(stored.id);
      fetchFriends(stored.id).then(setFriendsList);
      fetchMatchHistory(stored.id).then(setHistoryList);
    } else {
      fetchFriends(null).then(setFriendsList);
      fetchMatchHistory(null).then(setHistoryList);
    }
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

  // Countdown timer for incoming call modal
  useEffect(() => {
    if (!incomingCallRequest) {
      setIncomingCountdown(25);
      return;
    }
    const interval = setInterval(() => {
      setIncomingCountdown((prev) => {
        if (prev <= 1) {
          declineVideoCall();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [incomingCallRequest]);

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, "0");
    const secs = (totalSeconds % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  };

  // Cleanup WebRTC & media streams
  const cleanupMediaAndPeer = useCallback(() => {
    if (callTimeoutTimerRef.current) {
      clearTimeout(callTimeoutTimerRef.current);
      callTimeoutTimerRef.current = null;
    }
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
    setCallDeclinedMessage(null);
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

  const acquireLocalMedia = useCallback(async (startWithVideo = true): Promise<MediaStream | null> => {
    try {
      if (startWithVideo) {
        return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } else {
        return await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      }
    } catch {
      try {
        return await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      } catch {
        return null;
      }
    }
  }, []);

  const establishCall = useCallback(
    async (isCaller: boolean, userDisabledInitialCam = false) => {
      setIsVideoActive(true);
      setOutgoingCallWaiting(false);
      setIncomingCallRequest(false);
      setCallDurationSeconds(0);
      setCallDeclinedMessage(null);

      const stream = await acquireLocalMedia(!userDisabledInitialCam);
      localStreamRef.current = stream;

      if (stream) {
        setHasLocalMedia(true);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        if (userDisabledInitialCam) {
          setIsCamOff(true);
        }
        socketRef.current?.emit("video-state", { enabled: !userDisabledInitialCam });
      } else {
        setHasLocalMedia(false);
        setIsCamOff(true);
        setVideoError("Microphone/Camera not detected. You can still view and hear the stranger.");
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

  // Stop video call locally and notify the partner via call-end
  const stopVideo = () => {
    cleanupMediaAndPeer();
    socketRef.current?.emit("call-end");
    socketRef.current?.emit("video-state", { enabled: false });
    setIsVideoActive(false);
    setShowToast("Left video call. Back to text chat.");
    setTimeout(() => setShowToast(null), 2500);
  };

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
        isMember?: boolean;
        handle?: string | null;
      }) => {
        cleanupMediaAndPeer();
        setPartner(d.nick || "River");
        setPartnerGender(d.gender || "female");
        setPartnerStyle(d.style || "text");
        setPartnerIsMember(!!d.isMember);
        setPartnerHandle(d.handle || null);
        setFriendStatus("none");
        setCommon(d.common && d.common.length > 0 ? d.common : selectedTopics.slice(0, 1));
        setMsgs([]);
        setPhase("chat");

        // Broad stable region locked per match
        const chosenRegion = BROAD_REGIONS[Math.floor(Math.random() * BROAD_REGIONS.length)];
        setPartnerLocation(chosenRegion);

        // Record to real history
        const savedId = typeof window !== "undefined" ? localStorage.getItem("neonchat_user_id") : null;
        recordMatchHistory(savedId, d.nick || "River", d.gender || "female", d.common || [], false, d.handle || undefined, !!d.isMember);
        fetchMatchHistory(savedId).then(setHistoryList);
      }
    );

    // Support receiving both plain text, images, and audio payloads
    s.on("message", (payload: any) => {
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now
        .getMinutes()
        .toString()
        .padStart(2, "0")}`;

      if (typeof payload === "string") {
        setMsgs((m) => [...m, { mine: false, type: "text", text: payload, time: timeStr }]);
      } else if (payload && typeof payload === "object") {
        setMsgs((m) => [
          ...m,
          {
            mine: false,
            type: payload.type || "text",
            text: payload.text || "",
            mediaUrl: payload.mediaUrl,
            time: payload.time || timeStr,
          },
        ]);
      }
    });

    // Remote partner ended video call -> close video viewport immediately for other person!
    s.on("call-end", () => {
      cleanupMediaAndPeer();
      setIsVideoActive(false);
      setShowToast("Stranger ended the video call. Back to text chat.");
      setTimeout(() => setShowToast(null), 3500);
    });

    s.on("call-request", () => {
      setIncomingCallRequest(true);
    });

    s.on("call-cancel", () => {
      setIncomingCallRequest(false);
      setShowToast("Call was cancelled by stranger.");
      setTimeout(() => setShowToast(null), 3000);
    });

    s.on("call-response", async (response: { accepted: boolean }) => {
      if (callTimeoutTimerRef.current) {
        clearTimeout(callTimeoutTimerRef.current);
        callTimeoutTimerRef.current = null;
      }
      setOutgoingCallWaiting(false);
      if (response.accepted) {
        setShowToast("Call accepted! Connecting...");
        setTimeout(() => setShowToast(null), 3000);
        await establishCall(true, false);
      } else {
        setCallDeclinedMessage("Stranger declined video call");
        setTimeout(() => setCallDeclinedMessage(null), 4000);
      }
    });

    s.on("friend-request", (senderInfo?: { nick?: string; handle?: string; isMember?: boolean }) => {
      setFriendStatus("received");
      if (senderInfo?.handle) setPartnerHandle(senderInfo.handle);
      if (senderInfo?.isMember !== undefined) setPartnerIsMember(senderInfo.isMember);
      setShowToast(`${senderInfo?.nick || partner || "Stranger"} sent you a friend request!`);
      setTimeout(() => setShowToast(null), 4000);
    });

    s.on("friend-accept", (acceptInfo?: { nick?: string; handle?: string; isMember?: boolean }) => {
      setFriendStatus("friends");
      if (acceptInfo?.handle) setPartnerHandle(acceptInfo.handle);
      if (acceptInfo?.isMember !== undefined) setPartnerIsMember(acceptInfo.isMember);
      setShowToast(`You and ${acceptInfo?.nick || partner || "Stranger"} are now connected! 💜`);
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
    const count = Math.floor(Math.random() * 2) + 2;
    setSelectedTopics(shuffled.slice(0, count));
    setShowToast("Surprise signals selected!");
    setTimeout(() => setShowToast(null), 2500);
  };

  const find = async () => {
    if (!isAgeConfirmed) return;
    cleanupMediaAndPeer();
    setPhase("waiting");

    const uid = await getOrCreateUserProfile(
      nick || "Clover",
      gender,
      selectedTopics,
      currentMember?.handle,
      !!currentMember?.isMember
    );
    if (uid) setUserId(uid);

    socketRef.current?.emit("find", {
      nick: nick || "Clover",
      gender,
      interests: selectedTopics,
      style: conversationStyle,
      isMember: !!currentMember?.isMember,
      handle: currentMember?.handle || null,
    });
  };

  const next = () => {
    const previousPartnerName = partner;
    cleanupMediaAndPeer();
    socketRef.current?.emit("call-end");
    socketRef.current?.emit("leave");

    // Show 3-second undo banner
    setUndoBanner({ active: true, prevPartner: previousPartnerName });
    if (undoSkipTimerRef.current) clearTimeout(undoSkipTimerRef.current);
    undoSkipTimerRef.current = setTimeout(() => {
      setUndoBanner(null);
    }, 3000);

    find();
  };

  const undoSkip = () => {
    if (undoSkipTimerRef.current) clearTimeout(undoSkipTimerRef.current);
    setUndoBanner(null);
    setShowToast("Reconnecting with " + (undoBanner?.prevPartner || "stranger"));
    setTimeout(() => setShowToast(null), 2500);
  };

  const stop = () => {
    cleanupMediaAndPeer();
    socketRef.current?.emit("call-end");
    socketRef.current?.emit("leave");
    setPhase("setup");
  };

  // Send regular text message
  const send = (overrideText?: string) => {
    const text = (overrideText ?? draft).trim();
    if (!text) return;
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now
      .getMinutes()
      .toString()
      .padStart(2, "0")}`;

    const payload: Msg = { mine: true, type: "text", text, time: timeStr };
    socketRef.current?.emit("message", text);
    setMsgs((m) => [...m, payload]);
    if (!overrideText) setDraft("");
  };

  // Image Upload & Compress Handler
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      setShowToast("Please choose an image under 8MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // Compress/resize on canvas to max 1200px
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        const maxDim = 1200;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);

        const compressedBase64 = canvas.toDataURL("image/jpeg", 0.8);
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now
          .getMinutes()
          .toString()
          .padStart(2, "0")}`;

        const payload = {
          type: "image" as const,
          mediaUrl: compressedBase64,
          time: timeStr,
          text: "Photo",
        };

        socketRef.current?.emit("message", payload);
        setMsgs((m) => [...m, { mine: true, ...payload }]);
        setShowToast("Photo sent!");
        setTimeout(() => setShowToast(null), 2000);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // Voice Recording Handlers
  const startRecordingAudio = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start();
      setIsRecordingAudio(true);
      setRecordingSeconds(0);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch {
      setShowToast("Microphone access unavailable or denied.");
    }
  };

  const stopAndSendRecording = () => {
    if (!mediaRecorderRef.current || !isRecordingAudio) return;
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecordingAudio(false);

    const recorder = mediaRecorderRef.current;
    recorder.onstop = () => {
      const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64Audio = reader.result as string;
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now
          .getMinutes()
          .toString()
          .padStart(2, "0")}`;

        const payload = {
          type: "audio" as const,
          mediaUrl: base64Audio,
          time: timeStr,
          text: `Voice note (${recordingSeconds}s)`,
        };

        socketRef.current?.emit("message", payload);
        setMsgs((m) => [...m, { mine: true, ...payload }]);
        setShowToast("Voice message sent!");
        setTimeout(() => setShowToast(null), 2000);
      };
      reader.readAsDataURL(blob);
    };
    recorder.stop();
  };

  const cancelRecordingAudio = () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecordingAudio(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    audioChunksRef.current = [];
    setShowToast("Voice recording cancelled.");
    setTimeout(() => setShowToast(null), 2000);
  };

  const sendFriendRequest = () => {
    socketRef.current?.emit("friend-request", {
      nick,
      gender,
      handle: currentMember?.handle,
      isMember: !!currentMember?.isMember,
    });
    setFriendStatus("sent");
    setShowToast("Friend request sent!");
    setTimeout(() => setShowToast(null), 3000);
  };

  const acceptFriendRequest = async () => {
    socketRef.current?.emit("friend-accept", {
      nick,
      gender,
      handle: currentMember?.handle,
      isMember: !!currentMember?.isMember,
    });
    setFriendStatus("friends");
    setShowToast(`You and ${partner || "Stranger"} are now friends! 💜`);
    setTimeout(() => setShowToast(null), 4000);

    await saveFriendship(
      userId,
      partner,
      partnerGender,
      partnerHandle || undefined,
      partnerIsMember
    );
    fetchFriends(userId).then(setFriendsList);
  };

  // Live availability check handler with 400ms debounce
  const handleHandleInputChange = (val: string) => {
    setClaimHandleInput(val);
    setClaimHandleStatus(null);
    setAuthError(null);
    if (!val.trim()) return;

    // Check basic client rules first
    const clientValidation = validateHandle(val);
    if (!clientValidation.valid) {
      setClaimHandleStatus({
        available: false,
        reason: clientValidation.error,
      });
      return;
    }

    if (checkHandleTimerRef.current) clearTimeout(checkHandleTimerRef.current);
    setClaimHandleChecking(true);

    checkHandleTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/handle/check?handle=${encodeURIComponent(val)}`);
        const data = await res.json();
        setClaimHandleStatus({
          available: data.available,
          reason: data.reason,
        });
      } catch {
        setClaimHandleStatus({
          available: false,
          reason: "Network error checking handle",
        });
      } finally {
        setClaimHandleChecking(false);
      }
    }, 400);
  };

  // Open handle claim modal with generated suggestions
  const openClaimHandleModal = (seed?: string) => {
    const baseSeed = seed || nick || "clover";
    const norm = normalizeHandle(baseSeed);
    setClaimHandleInput(norm);
    setClaimHandleSuggestions(generateHandleSuggestions(baseSeed));
    setClaimHandleStatus(null);
    setAuthError(null);
    setAuthModalTab("claim");
    setShowAuthModal(true);
  };

  // Claim permanent handle
  const handleClaimPermanentHandle = async (handleToClaim?: string) => {
    const target = handleToClaim || claimHandleInput;
    if (!target) return;

    const validation = validateHandle(target);
    if (!validation.valid) {
      setAuthError(validation.error || "Invalid handle");
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch("/api/handle/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: target,
          userId: currentMember?.id || userId,
          email: currentMember?.email,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setAuthError(data.error || "Failed to reserve handle");
        return;
      }

      const updated: AuthMember = {
        id: data.userId || currentMember?.id || userId || "usr_" + Math.random().toString(36).substring(2, 9),
        email: currentMember?.email || "anonymous.member@quietsignal.app",
        handle: data.handle,
        isMember: true,
        lastRenamedAt: new Date().toISOString(),
      };
      saveStoredMember(updated);
      setCurrentMember(updated);
      setNick(data.handle);
      setShowAuthModal(false);
      setShowToast(`@${data.handle} reserved permanently! 🎉`);
      setTimeout(() => setShowToast(null), 3500);
    } catch {
      setAuthError("Failed to claim handle. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  // Send magic link or OTP
  const handleSendMagicLink = async () => {
    setAuthLoading(true);
    setAuthError(null);
    setAuthSuccessMessage(null);
    try {
      const res = await sendMagicLinkOrCode(authEmail);
      if (!res.success) {
        setAuthError(res.message);
      } else {
        setAuthOtpSent(true);
        setAuthSuccessMessage(res.message);
      }
    } catch {
      setAuthError("Failed to send login request");
    } finally {
      setAuthLoading(false);
    }
  };

  // Verify email OTP code
  const handleVerifyOtp = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await verifyEmailCode(authEmail, authOtpCode);
      if (!res.success || !res.member) {
        setAuthError(res.error || "Verification failed");
      } else {
        setCurrentMember(res.member);
        if (res.member.handle) {
          setNick(res.member.handle);
        }
        setShowAuthModal(false);
        setAuthOtpSent(false);
        setAuthOtpCode("");
        setShowToast(`Welcome back, @${res.member.handle || "Member"}!`);
        setTimeout(() => setShowToast(null), 3000);
      }
    } catch {
      setAuthError("Failed to verify code");
    } finally {
      setAuthLoading(false);
    }
  };

  // Social sign in (Google or Apple)
  const handleOAuthSignIn = async (provider: "google" | "apple") => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await signInOAuth(provider);
    } catch {
      setAuthError(`Sign in with ${provider} failed`);
    } finally {
      setAuthLoading(false);
    }
  };

  // Logout member and revert to guest
  const handleLogout = async () => {
    await logoutMember();
    setCurrentMember(null);
    setNick("Clover");
    setShowToast("Signed out. Switched to Guest mode.");
    setTimeout(() => setShowToast(null), 3000);
  };

  const requestVideoCall = () => {
    if (outgoingCallWaiting) return;
    setOutgoingCallWaiting(true);
    setCallDeclinedMessage(null);
    socketRef.current?.emit("call-request", { from: nick });

    if (callTimeoutTimerRef.current) clearTimeout(callTimeoutTimerRef.current);
    callTimeoutTimerRef.current = setTimeout(() => {
      setOutgoingCallWaiting(false);
      setCallDeclinedMessage("No answer from stranger");
      socketRef.current?.emit("call-cancel");
      setTimeout(() => setCallDeclinedMessage(null), 4000);
    }, 25000);
  };

  const cancelCallRequest = () => {
    if (callTimeoutTimerRef.current) clearTimeout(callTimeoutTimerRef.current);
    setOutgoingCallWaiting(false);
    socketRef.current?.emit("call-cancel");
    setShowToast("Video request cancelled.");
    setTimeout(() => setShowToast(null), 2500);
  };

  const acceptVideoCall = async () => {
    setIncomingCallRequest(false);
    socketRef.current?.emit("call-response", { accepted: true });
    await establishCall(false, previewCameraMuted);
  };

  const declineVideoCall = () => {
    setIncomingCallRequest(false);
    socketRef.current?.emit("call-response", { accepted: false });
    setShowToast("Declined video call.");
    setTimeout(() => setShowToast(null), 2500);
  };

  const blockFromCallModal = () => {
    setIncomingCallRequest(false);
    socketRef.current?.emit("call-response", { accepted: false });
    setShowToast(`${partner} was blocked.`);
    next();
  };

  const submitReportAndBlock = () => {
    setShowReportModal(false);
    setShowToast(`${partner} was reported (${reportReason}) and blocked.`);
    setTimeout(() => setShowToast(null), 3500);
    next();
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
        socketRef.current?.emit("video-state", { enabled: videoTrack.enabled });
      }
    }
  };

  // Consistent geometric gradient avatar generator (zero external photos, reinforcing no profiles)
  const renderAvatar = (name: string, size = "w-10 h-10 text-sm") => {
    const hash = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const palettes = [
      { from: "from-indigo-500", to: "to-purple-600" },
      { from: "from-rose-500", to: "to-amber-500" },
      { from: "from-emerald-500", to: "to-teal-600" },
      { from: "from-sky-500", to: "to-blue-600" },
      { from: "from-violet-500", to: "to-fuchsia-600" },
    ];
    const p = palettes[hash % palettes.length];
    const initial = name ? name.slice(0, 1).toUpperCase() : "S";

    return (
      <div className={`${size} rounded-full bg-gradient-to-tr ${p.from} ${p.to} flex items-center justify-center font-bold text-white shadow-2xs shrink-0 select-none`}>
        <span>{initial}</span>
      </div>
    );
  };

  // Dynamic icebreaker prompts based on shared signal
  const getIcebreakers = (topics: string[]) => {
    const first = (topics[0] || "").toLowerCase();
    if (first.includes("music")) {
      return [
        "What have you been listening to lately?",
        "Favorite rainy-day album or artist?",
        "Best concert you've ever been to?",
      ];
    }
    if (first.includes("book")) {
      return [
        "Reading anything good right now?",
        "Book you wish you could read again for the first time?",
        "Fiction or non-fiction person?",
      ];
    }
    if (first.includes("travel")) {
      return [
        "What's the most memorable trip you've taken?",
        "Where's top of your travel bucket list?",
        "Solo trips or traveling with friends?",
      ];
    }
    if (first.includes("gaming")) {
      return [
        "What games are you currently playing?",
        "Co-op multiplayer or deep single player?",
        "All-time favorite game?",
      ];
    }
    return [
      "What's on your mind tonight?",
      "Night owl or early morning person?",
      "How has your week been going?",
    ];
  };

  return (
    <div className="flex h-[100dvh] w-screen overflow-hidden bg-[#f8fafc] dark:bg-[#0b0f19] text-slate-800 dark:text-slate-100 font-sans select-none antialiased transition-colors duration-200">
      
      {/* Hidden File Input for Image Sharing */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageSelect}
      />

      {/* Enlarged Image Lightbox Modal */}
      {enlargedImage && (
        <div
          onClick={() => setEnlargedImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 cursor-pointer animate-in fade-in"
        >
          <div className="relative max-w-3xl max-h-[90vh]">
            <img
              src={enlargedImage}
              alt="Enlarged"
              className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl"
            />
            <button
              onClick={() => setEnlargedImage(null)}
              className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center text-sm font-bold"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Toast Notification (Bottom-center positioned to never overlap headers) */}
      {showToast && (
        <div className="fixed bottom-6 inset-x-0 mx-auto w-fit max-w-[90vw] z-50 bg-slate-900/95 dark:bg-white/95 text-white dark:text-slate-900 px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2.5 animate-in slide-in-from-bottom-2 duration-200">
          <div className="w-2 h-2 rounded-full bg-[#5b4df2] animate-ping shrink-0" />
          <span className="text-xs font-semibold">{showToast}</span>
        </div>
      )}

      {/* Undo Skip Floating Banner */}
      {undoBanner && (
        <div className="fixed bottom-6 inset-x-0 mx-auto w-fit max-w-[90vw] z-50 bg-[#1e2330] text-white px-4 py-3 rounded-2xl shadow-2xl border border-white/10 flex items-center gap-3 animate-in slide-in-from-bottom-3 duration-200">
          <span className="text-xs text-slate-300">Skipped {undoBanner.prevPartner}</span>
          <button
            onClick={undoSkip}
            className="px-3 py-1 rounded-xl bg-white/20 hover:bg-white/30 text-white font-bold text-xs transition-colors cursor-pointer"
          >
            Undo (3s)
          </button>
        </div>
      )}

      {/* Incoming Call Request Modal */}
      {incomingCallRequest && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="video-call-title"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in"
          onKeyDown={(e) => e.key === "Escape" && declineVideoCall()}
        >
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-5 shadow-2xl animate-in slide-in-from-bottom sm:slide-in-from-bottom-0 sm:zoom-in-95">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-2.5 py-1 rounded-full">
                Auto-declines in {incomingCountdown}s
              </span>
              <button
                onClick={declineVideoCall}
                className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xs flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="text-center space-y-2">
              <div className="relative w-16 h-16 mx-auto">
                <div className="absolute inset-0 rounded-full border-4 border-[#5b4df2]/30 animate-ping"></div>
                {renderAvatar(partner, "w-16 h-16 text-2xl")}
              </div>
              <h3 id="video-call-title" className="text-base font-bold text-slate-900 dark:text-white">
                {partner} is requesting a video call
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-xs mx-auto">
                They can see you once you accept. You can mute or leave the call at any time.
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/60 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">{previewCameraMuted ? "🙈" : "📹"}</span>
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">Join with camera off</div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">View stranger without sharing video</div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={previewCameraMuted}
                onChange={(e) => setPreviewCameraMuted(e.target.checked)}
                className="w-4 h-4 rounded text-[#5b4df2] accent-[#5b4df2] cursor-pointer"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={blockFromCallModal}
                className="py-3 px-3 rounded-xl border border-rose-200 dark:border-rose-900/60 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-xs font-semibold transition-colors cursor-pointer min-h-[44px]"
              >
                Block
              </button>
              <button
                onClick={declineVideoCall}
                className="flex-1 py-3 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs transition-colors cursor-pointer min-h-[44px]"
              >
                Decline
              </button>
              <button
                onClick={acceptVideoCall}
                className="flex-1 py-3 px-4 rounded-xl bg-[#5b4df2] hover:bg-[#4d3fe0] text-white font-bold text-xs shadow-md shadow-[#5b4df2]/25 transition-all cursor-pointer flex items-center justify-center gap-1.5 min-h-[44px]"
              >
                <span>Accept</span>
                <span>→</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Safety & Moderation Modal */}
      {showSafetyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-[#5b4df2] flex items-center justify-center">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Safety & Privacy Guide</h3>
              </div>
              <button
                onClick={() => setShowSafetyModal(false)}
                className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center justify-center text-xs"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600 dark:text-slate-300 max-h-[70vh] overflow-y-auto pr-1">
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-800 space-y-1">
                <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#5b4df2]"></span>
                  <span>Temporary session memory</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Stranger messages exist only during active chat and vanish completely when disconnected. Only conversations you mutually save as friends are preserved.
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-800 space-y-1">
                <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span>100% Peer-to-peer video</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Video calls are encrypted end-to-end between browsers using WebRTC. Media never touches a recording server.
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-800 space-y-1">
                <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                  <span>Report & Evidence Submission</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  If someone violates community guidelines, you can report them instantly and attach recent messages as evidence to permanently block them.
                </p>
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

      {/* Report / Block Modal with Evidence Attachment */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-2xl">
            <div className="w-12 h-12 mx-auto rounded-full bg-rose-50 dark:bg-rose-950/50 text-rose-500 flex items-center justify-center">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>

            <div className="text-center space-y-1">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Report & Block {partner}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                This will immediately disconnect your session and prevent them from matching with you again.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">Reason</label>
              <select
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-800 dark:text-white outline-none focus:border-[#5b4df2]"
              >
                <option value="Inappropriate behavior">Inappropriate behavior</option>
                <option value="Harassment or hate speech">Harassment or hate speech</option>
                <option value="Spam or bot">Spam or bot</option>
                <option value="Under 18 violation">Under 18 violation</option>
              </select>
            </div>

            <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={reportAttachEvidence}
                onChange={(e) => setReportAttachEvidence(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded text-[#5b4df2] accent-[#5b4df2]"
              />
              <span className="text-[11px] leading-tight">
                Attach last messages as evidence for moderation review
              </span>
            </label>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowReportModal(false)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold min-h-[44px]"
              >
                Cancel
              </button>
              <button
                onClick={submitReportAndBlock}
                className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md shadow-rose-600/20 min-h-[44px]"
              >
                Report & Block
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Legal & Policy Modals */}
      {legalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-2xl">
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
                  <p>1. <strong>Respect consent:</strong> Do not pressure strangers for personal contact info, real names, or video.</p>
                  <p>2. <strong>Zero harassment tolerance:</strong> Harassment, hate speech, bullying, and illicit material result in immediate permanent IP blocks.</p>
                  <p>3. <strong>18+ Only:</strong> All users must be at least 18 years of age.</p>
                </>
              )}
              {legalModal === "privacy" && (
                <>
                  <p className="font-semibold text-slate-900 dark:text-white">Privacy by architecture.</p>
                  <p>• <strong>Temporary session memory:</strong> Messages vanish when a session ends. Only chats with mutual friends are saved.</p>
                  <p>• <strong>Encrypted WebRTC:</strong> Video/audio flows peer-to-peer between users without central server recording.</p>
                  <p>• <strong>No Real Names Required:</strong> You choose disposable anonymous handles.</p>
                </>
              )}
              {legalModal === "terms" && (
                <>
                  <p className="font-semibold text-slate-900 dark:text-white">Terms of use summary.</p>
                  <p>By using Quiet Signal, you confirm you are 18+, agree to maintain respectful conduct, and understand sessions can be ended at any moment by either party.</p>
                </>
              )}
            </div>

            <button
              onClick={() => setLegalModal(null)}
              className="w-full py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors min-h-[44px]"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Auth & Handle Reservation Modal */}
      {showAuthModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in"
        >
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 sm:p-7 space-y-5 shadow-2xl animate-in zoom-in-95">
            {/* Header */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-[#5b4df2] flex items-center justify-center font-bold text-sm">
                  {authModalTab === "claim" ? "🏷️" : "🔐"}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white leading-tight">
                    {authModalTab === "claim" ? "Claim Your Permanent Handle" : "Sign In to Quiet Signal"}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {authModalTab === "claim"
                      ? "Reserve a unique handle across sessions"
                      : "Passwordless authentication"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowAuthModal(false);
                  setAuthError(null);
                  setAuthSuccessMessage(null);
                }}
                className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center justify-center text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Privacy Reassurance Banner */}
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300">
              <span className="text-sm mt-0.5">🛡️</span>
              <p className="text-[11px] leading-relaxed">
                <strong>Zero stranger exposure:</strong> Your email and social accounts are stored separately and strictly private. They are never revealed to other chatters.
              </p>
            </div>

            {/* Navigation Tabs */}
            <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => {
                  setAuthModalTab("claim");
                  setAuthError(null);
                }}
                className={`flex-1 py-1.5 rounded-lg transition-all ${
                  authModalTab === "claim"
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
                    : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                Reserve Handle
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthModalTab("signin");
                  setAuthError(null);
                }}
                className={`flex-1 py-1.5 rounded-lg transition-all ${
                  authModalTab === "signin"
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
                    : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                Sign In (Email / Social)
              </button>
            </div>

            {/* Error & Success Messages */}
            {authError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-300 text-xs font-medium">
                {authError}
              </div>
            )}
            {authSuccessMessage && (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 text-xs font-medium">
                {authSuccessMessage}
              </div>
            )}

            {/* TAB 1: CLAIM HANDLE */}
            {authModalTab === "claim" && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                    Choose your permanent handle
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">@</span>
                    <input
                      type="text"
                      value={claimHandleInput}
                      onChange={(e) => handleHandleInputChange(e.target.value)}
                      placeholder="e.g. clover_44"
                      maxLength={20}
                      className="w-full pl-8 pr-10 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#5b4df2] font-mono min-h-[44px]"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      {claimHandleChecking && (
                        <div className="w-4 h-4 border-2 border-[#5b4df2] border-t-transparent rounded-full animate-spin" />
                      )}
                      {!claimHandleChecking && claimHandleStatus && (
                        <span>{claimHandleStatus.available ? "✅" : "❌"}</span>
                      )}
                    </div>
                  </div>

                  {/* Live availability status note */}
                  {claimHandleStatus && (
                    <div className={`text-[11px] font-medium ${
                      claimHandleStatus.available ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                    }`}>
                      {claimHandleStatus.available
                        ? `✓ @${claimHandleInput} is free and ready to reserve!`
                        : `✗ ${claimHandleStatus.reason || "Handle not available"}`}
                    </div>
                  )}

                  <p className="text-[10px] text-slate-400 leading-tight">
                    3–20 chars, lowercase letters, numbers, and underscores. Protected from lookalikes. Can be changed at most once every 30 days.
                  </p>
                </div>

                {/* Suggestions */}
                {claimHandleSuggestions.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Suggestions:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {claimHandleSuggestions.map((sug) => (
                        <button
                          key={sug}
                          type="button"
                          onClick={() => handleHandleInputChange(sug)}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-mono transition-colors"
                        >
                          @{sug}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => handleClaimPermanentHandle()}
                  disabled={authLoading || claimHandleChecking || (claimHandleStatus ? !claimHandleStatus.available : !claimHandleInput)}
                  className="w-full py-3 px-4 rounded-xl bg-[#5b4df2] hover:bg-[#4d3fe0] disabled:opacity-40 text-white font-semibold text-xs transition-all shadow-md shadow-[#5b4df2]/20 cursor-pointer min-h-[44px]"
                >
                  {authLoading ? "Reserving..." : "Reserve This Handle"}
                </button>
              </div>
            )}

            {/* TAB 2: SIGN IN (PASSWORDLESS) */}
            {authModalTab === "signin" && (
              <div className="space-y-4">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                      Email Magic Link or Code
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={authEmail}
                        onChange={(e) => setAuthEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#5b4df2] min-h-[44px]"
                      />
                      <button
                        type="button"
                        onClick={handleSendMagicLink}
                        disabled={authLoading || !authEmail.includes("@")}
                        className="px-4 py-2.5 rounded-xl bg-[#5b4df2] hover:bg-[#4d3fe0] disabled:opacity-40 text-white text-xs font-semibold shrink-0 cursor-pointer min-h-[44px]"
                      >
                        {authLoading ? "Sending..." : "Send Code"}
                      </button>
                    </div>
                  </div>

                  {authOtpSent && (
                    <div className="space-y-1.5 animate-in fade-in">
                      <label className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                        Enter 6-digit code
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={authOtpCode}
                          onChange={(e) => setAuthOtpCode(e.target.value)}
                          placeholder="e.g. 778899"
                          maxLength={6}
                          className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 text-center tracking-widest font-mono text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#5b4df2] min-h-[44px]"
                        />
                        <button
                          type="button"
                          onClick={handleVerifyOtp}
                          disabled={authLoading || authOtpCode.length < 6}
                          className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold shrink-0 cursor-pointer min-h-[44px]"
                        >
                          Verify & Sign In
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Social Sign-In Divider */}
                <div className="relative my-3">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-200 dark:border-slate-800"></div>
                  </div>
                  <div className="relative flex justify-center text-[10px] uppercase tracking-wider text-slate-400">
                    <span className="bg-white dark:bg-slate-900 px-3">or instant social sign-in</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => handleOAuthSignIn("google")}
                    disabled={authLoading}
                    className="py-2.5 px-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer min-h-[44px]"
                  >
                    <span>Google</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOAuthSignIn("apple")}
                    disabled={authLoading}
                    className="py-2.5 px-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer min-h-[44px]"
                  >
                    <span>Apple</span>
                  </button>
                </div>
              </div>
            )}

            {/* Continue as Guest option at bottom */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-center">
              <button
                type="button"
                onClick={() => {
                  setShowAuthModal(false);
                }}
                className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors py-1 cursor-pointer"
              >
                No account needed · Continue as Guest
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          1. SETUP / WELCOME BOARD PHASE (Image 1 Refined)
      ======================================================== */}
      {phase === "setup" && (
        <div className="flex-1 flex flex-col h-full overflow-y-auto bg-white dark:bg-[#0b0f19]">
          <header className="px-6 md:px-10 py-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 sticky top-0 bg-white/90 dark:bg-[#0b0f19]/90 backdrop-blur-md z-20">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[#5b4df2] flex items-center justify-center text-white shadow-2xs">
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

            <div className="flex items-center gap-2">
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <span>{onlineCount.toLocaleString()} online</span>
              </span>

              {currentMember ? (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-800/80 text-xs">
                  <span className="font-bold text-[#5b4df2] dark:text-indigo-400">@{currentMember.handle}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#5b4df2] text-white font-semibold">Member</span>
                  <button
                    onClick={handleLogout}
                    className="ml-1 text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                    title="Sign out of account"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setAuthModalTab("signin");
                    setShowAuthModal(true);
                  }}
                  className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors cursor-pointer min-h-[36px]"
                >
                  Sign in
                </button>
              )}

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

          <main className="flex-1 flex flex-col justify-between p-4 sm:p-6 md:p-10 lg:p-12 max-w-[1200px] mx-auto w-full">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center pt-2 md:pt-4">
              
              {/* Left Column */}
              <div className="lg:col-span-6 space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/80 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span>Private matching active</span>
                  </div>

                  <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-bold">
                    18+ community
                  </span>
                </div>

                <div className="space-y-3">
                  <h2 className="text-3xl sm:text-4xl lg:text-[42px] font-black text-slate-900 dark:text-white tracking-tight leading-[1.15]">
                    Meet someone new, without the pressure.
                  </h2>
                  <p className="text-slate-600 dark:text-slate-300 text-sm sm:text-base leading-relaxed">
                    Choose a few signals and we&apos;ll introduce you to someone who wants the same kind of conversation. No profiles, no pressure, leave whenever.
                  </p>
                </div>

                {/* Soft First Conversation Preview */}
                <div className="hidden sm:block p-4 sm:p-5 rounded-3xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800 space-y-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center justify-between">
                    <span>What a first chat looks like</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold lowercase">matched on music</span>
                  </div>

                  <div className="flex items-start gap-2.5">
                    {renderAvatar("River", "w-7 h-7 text-xs")}
                    <div className="bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs px-3.5 py-2 rounded-2xl rounded-tl-xs shadow-2xs max-w-[85%]">
                      Hey there! What kind of music are you listening to tonight?
                    </div>
                  </div>

                  <div className="flex items-end justify-end gap-2.5">
                    <div className="bg-[#5b4df2] text-white text-xs px-3.5 py-2 rounded-2xl rounded-tr-xs shadow-2xs max-w-[85%]">
                      A lot of mellow indie. Trying to build a rainy-day playlist 🌧️
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5">
                    {renderAvatar("River", "w-7 h-7 text-xs")}
                    <div className="bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs px-3.5 py-2 rounded-2xl rounded-tl-xs shadow-2xs max-w-[85%]">
                      Indie folk is the best for that. Have you heard the new Fleet Foxes?
                    </div>
                  </div>
                </div>

                {/* Trust and Safety Commitments */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-slate-700 dark:text-slate-300 font-medium pt-1">
                  <div className="flex items-center gap-2 p-2.5 rounded-2xl bg-white dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/60">
                    <svg className="w-4 h-4 text-[#5b4df2] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <span>Anonymous by default</span>
                  </div>

                  <div className="flex items-center gap-2 p-2.5 rounded-2xl bg-white dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/60">
                    <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    <span>Leave anytime (1-click)</span>
                  </div>

                  <div className="flex items-center gap-2 p-2.5 rounded-2xl bg-white dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/60">
                    <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
                    </svg>
                    <span>Instant report & block</span>
                  </div>

                  <div className="flex items-center gap-2 p-2.5 rounded-2xl bg-white dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/60">
                    <svg className="w-4 h-4 text-indigo-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    <span>Temporary session memory</span>
                  </div>
                </div>
              </div>

              {/* Right Column: "Set your signal" Card */}
              <div className="lg:col-span-6">
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-6 sm:p-8 shadow-[0_12px_40px_-15px_rgba(0,0,0,0.07)] dark:shadow-none space-y-6">
                  
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">Set your signal</h3>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">Only share what helps us match you.</p>
                    </div>

                    <button
                      type="button"
                      onClick={surpriseTopics}
                      className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-[#5b4df2] dark:text-indigo-400 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer min-h-[38px]"
                      title="Surprise me: pick random signals"
                      aria-label="Surprise me with random topics"
                    >
                      <span>✦</span>
                      <span>Surprise me</span>
                    </button>
                  </div>

                  {/* Mobile Stepper Indicator */}
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

                  {/* Step 1: Nickname */}
                  <div className={`space-y-2 ${mobileStep !== 1 ? "hidden md:block" : ""}`}>
                    <div className="flex items-center justify-between">
                      <label htmlFor="nickname-input" className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                        How should we call you?
                      </label>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        {currentMember ? "Permanent Handle" : "Not your real name"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          id="nickname-input"
                          type="text"
                          className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/80 text-base text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#5b4df2] focus:bg-white dark:focus:bg-slate-800 transition-all min-h-[44px]"
                          placeholder="e.g. Clover"
                          value={nick}
                          maxLength={20}
                          onChange={(e) => setNick(e.target.value)}
                        />
                        {currentMember && (
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#5b4df2] flex items-center gap-1 bg-indigo-50 dark:bg-indigo-950 px-2 py-0.5 rounded-md">
                            <span>🔒</span>
                            <span>Member</span>
                          </span>
                        )}
                      </div>

                      {!currentMember && (
                        <button
                          type="button"
                          onClick={shuffleNickname}
                          className="px-3.5 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer min-h-[44px]"
                          title="Shuffle anonymous name"
                          aria-label="Shuffle anonymous name"
                        >
                          <span>🎲</span>
                          <span className="hidden sm:inline">Shuffle</span>
                        </button>
                      )}
                    </div>

                    {/* Handle Reservation / Account Status Link */}
                    {currentMember ? (
                      <div className="flex items-center justify-between text-[11px] text-indigo-700 dark:text-indigo-300 font-medium bg-indigo-50/80 dark:bg-indigo-950/40 px-3 py-2 rounded-xl border border-indigo-100 dark:border-indigo-900/50">
                        <span className="flex items-center gap-1.5">
                          <span>✓</span>
                          <span>Reserved as <strong>@{currentMember.handle}</strong></span>
                        </span>
                        <button
                          type="button"
                          onClick={() => openClaimHandleModal(currentMember.handle)}
                          className="hover:underline font-semibold text-[#5b4df2] dark:text-indigo-400 cursor-pointer"
                        >
                          Change handle
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                        <span>Visible only to your match during chat.</span>
                        <button
                          type="button"
                          onClick={() => openClaimHandleModal(nick)}
                          className="text-[#5b4df2] hover:underline font-semibold cursor-pointer"
                        >
                          Keep this name? Sign in
                        </button>
                      </div>
                    )}

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

                  {/* Step 2: Topics Selection */}
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
                                ? "bg-[#5b4df2] text-white shadow-2xs shadow-[#5b4df2]/30"
                                : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-transparent"
                            }`}
                          >
                            <span>{topic}</span>
                            {isSelected && <span className="text-[10px] opacity-80">✓</span>}
                          </button>
                        );
                      })}
                    </div>

                    <div className="pt-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Add custom topic (e.g. Cinema, Podcasts)..."
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

                  {/* Step 3: Conversation Style */}
                  <div className={`space-y-2.5 ${mobileStep !== 3 ? "hidden md:block" : ""}`}>
                    <label className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                      Conversation style
                    </label>

                    <div
                      role="radiogroup"
                      aria-label="Conversation style"
                      className="grid grid-cols-2 gap-3"
                    >
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

                  {/* 18+ Mandatory Confirmation Checkbox */}
                  <div className={`pt-1 ${mobileStep !== 3 ? "hidden md:block" : ""}`}>
                    <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={isAgeConfirmed}
                        onChange={(e) => setIsAgeConfirmed(e.target.checked)}
                        className="w-4 h-4 rounded text-[#5b4df2] accent-[#5b4df2] cursor-pointer shrink-0"
                      />
                      <span>I confirm I am <strong>18+</strong> and agree to the Community Guidelines.</span>
                    </label>
                  </div>

                  {/* Primary CTA Area */}
                  <div className={`space-y-3 pt-1 ${mobileStep !== 3 ? "hidden md:block" : ""}`}>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 px-1 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        <span>Avg match: under 45s</span>
                      </span>
                      <span>Mutual consent required</span>
                    </div>

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
                        disabled={!isAgeConfirmed}
                        className="flex-1 py-3.5 px-4 rounded-xl bg-[#5b4df2] hover:bg-[#4d3fe0] disabled:opacity-40 disabled:hover:bg-[#5b4df2] text-white font-semibold text-sm tracking-wide shadow-md shadow-[#5b4df2]/25 transition-all cursor-pointer flex items-center justify-center gap-2 min-h-[44px] active:scale-[0.98]"
                      >
                        <span>Find my conversation</span>
                        <span className="text-base font-bold">→</span>
                      </button>
                    </div>

                    {/* Continuing path indicator */}
                    <div className="text-center pt-1">
                      {currentMember ? (
                        <div className="text-xs text-indigo-700 dark:text-indigo-300 font-medium flex items-center justify-center gap-1.5">
                          <span>🔒</span>
                          <span>Entering as verified Member <strong>(@{currentMember.handle})</strong></span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                          <span>Default: <strong>Continue as guest</strong> (one-time name)</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <footer className="mt-12 pt-6 border-t border-slate-200/80 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span>© 2026 Quiet Signal</span>
                <span>·</span>
                <span>WebRTC encrypted stranger chat</span>
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
          2. WAITING / MATCHING SCREEN
      ======================================================== */}
      {phase === "waiting" && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 bg-white dark:bg-[#0b0f19]">
          <div className="w-full max-w-sm rounded-3xl border border-slate-200 dark:border-slate-800 p-8 text-center space-y-6 shadow-xs bg-slate-50/50 dark:bg-slate-900">
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
              
              <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                {selectedTopics.map((t) => (
                  <span key={t} className="px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-100 dark:border-indigo-900 text-[#5b4df2] dark:text-indigo-400 text-xs font-semibold">
                    {t}
                  </span>
                ))}
              </div>

              <div className="text-[11px] text-slate-400 font-mono pt-1">
                Searching for {formatTimer(searchElapsedSeconds)}
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
              {conversationStyle === "video"
                ? "📹 Looking for another video-ready chatter"
                : "💬 Looking for another text-first chatter"}
            </div>

            {searchElapsedSeconds >= 25 && (
              <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-900/50 space-y-2 animate-in fade-in">
                <p className="text-xs text-amber-800 dark:text-amber-300 font-medium leading-relaxed">
                  Taking a bit longer. Want to broaden your signals?
                </p>
                <button
                  onClick={surpriseTopics}
                  className="w-full py-2 px-3 rounded-xl bg-amber-200/60 dark:bg-amber-900/60 hover:bg-amber-200 text-amber-900 dark:text-amber-200 font-semibold text-xs transition-colors"
                >
                  ✦ Add Surprise Signals
                </button>
              </div>
            )}

            <button
              onClick={stop}
              className="w-full py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-semibold transition-colors cursor-pointer min-h-[44px]"
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
          <header className="px-6 md:px-8 py-4.5 bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setPhase("setup")}
                className="w-8 h-8 rounded-xl bg-[#5b4df2] flex items-center justify-center text-white shadow-2xs cursor-pointer"
                title="Home"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </button>
              <div>
                <h1 className="text-sm font-bold text-slate-900 dark:text-white leading-tight">Your conversations</h1>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">Connections and saved friends</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggleTheme}
                aria-label="Toggle theme"
                className="w-8 h-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs flex items-center justify-center cursor-pointer"
              >
                {isDarkMode ? "☀️" : "🌙"}
              </button>

              <button
                onClick={() => setPhase("setup")}
                className="px-4 py-2 rounded-xl bg-[#5b4df2] hover:bg-[#4d3fe0] text-white text-xs font-semibold shadow-2xs transition-all cursor-pointer min-h-[40px]"
              >
                New match
              </button>
            </div>
          </header>

          <main className="flex-1 p-4 sm:p-8 max-w-6xl mx-auto w-full">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              <div className="lg:col-span-8 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-2xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Recent conversations</h3>
                  <span className="text-xs text-slate-400">{historyList.length} past matches</span>
                </div>

                {/* Real-only history list */}
                {historyList.length === 0 ? (
                  <div className="py-12 text-center space-y-2">
                    <div className="w-12 h-12 mx-auto rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 text-lg">
                      💬
                    </div>
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">No past conversations yet</p>
                    <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                      Matches you make during this session will be recorded here.
                    </p>
                  </div>
                ) : (
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
                              {item.last_message || "Past conversation"}
                            </p>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="text-[11px] text-slate-400">
                            {new Date(item.matched_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="lg:col-span-4 space-y-5">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white px-1">Connections</h3>

                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-2xs space-y-2">
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white">Conversations stay yours</h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    You can remove any chat or connection whenever you like.
                  </p>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-2xs space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">Your Friends</h4>
                    <span className="text-[10px] text-slate-400 font-medium">{friendsList.length} total</span>
                  </div>

                  {friendsList.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-400">
                      No friends saved yet. Click &ldquo;+ Friend&rdquo; during chat!
                    </div>
                  ) : (
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
                  )}
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
              <span>Safety</span>
            </button>
          </header>

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
                  className="px-4 py-2 rounded-full bg-[#eb5757] hover:bg-rose-600 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-rose-600/30 cursor-pointer min-h-[40px]"
                >
                  <span>Leave call</span>
                </button>

                <button
                  onClick={next}
                  className="px-4 py-2 rounded-full bg-[#5b4df2] hover:bg-[#4d3fe0] text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-[#5b4df2]/30 cursor-pointer min-h-[40px]"
                >
                  <span>Next person</span>
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

              {friendStatus === "none" && (
                <button
                  onClick={sendFriendRequest}
                  className="w-full py-3 rounded-2xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer min-h-[44px]"
                >
                  <span>+ Add as friend</span>
                </button>
              )}
              {friendStatus === "sent" && (
                <div className="w-full py-3 rounded-2xl bg-white/5 text-slate-400 text-xs font-medium text-center min-h-[44px] flex items-center justify-center">
                  Request Sent
                </div>
              )}
              {friendStatus === "received" && (
                <button
                  onClick={acceptFriendRequest}
                  className="w-full py-3 rounded-2xl bg-[#5b4df2] hover:bg-[#4d3fe0] text-white text-xs font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer min-h-[44px]"
                >
                  Accept Friend Request
                </button>
              )}
              {friendStatus === "friends" && (
                <div className="w-full py-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-semibold text-center flex items-center justify-center gap-1.5 min-h-[44px]">
                  <span>✓</span> Friends
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          5. ACTIVE STRANGER CHAT & RESPONSIVE VIEW
      ======================================================== */}
      {(phase === "chat" || phase === "ended") && !isVideoActive && (
        <div className="flex-1 flex flex-col h-full bg-[#f8fafc] dark:bg-[#0b0f19] overflow-hidden">
          
          {/* Top Navbar */}
          <header className="h-16 px-4 sm:px-6 bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMobileDrawerOpen(true)}
                className="md:hidden w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center text-xs"
                title="Open recent chats"
              >
                ☰
              </button>
              <button
                onClick={() => setPhase("history")}
                className="w-8 h-8 rounded-xl bg-[#5b4df2] flex items-center justify-center text-white shadow-2xs cursor-pointer"
                title="View conversations"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </button>
              <h1 className="text-sm font-bold text-slate-900 dark:text-white leading-tight">Quiet Signal</h1>
            </div>

            <div className="flex items-center gap-2.5">
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <span>Anonymous</span>
              </span>

              <button
                type="button"
                onClick={toggleTheme}
                aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
                className="w-8 h-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs flex items-center justify-center cursor-pointer"
                title="Toggle Theme"
              >
                {isDarkMode ? "☀️" : "🌙"}
              </button>

              <button
                onClick={() => setPhase("history")}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <span>History</span>
              </button>

              <button
                onClick={stop}
                className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer min-h-[38px]"
              >
                Leave chat
              </button>
            </div>
          </header>

          {/* Main Chat Workspace */}
          <div className="flex-1 flex overflow-hidden relative">
            
            {/* 1. Left Sidebar: REAL Recent Chats Only (NO dummy data!) */}
            <aside className={`fixed inset-y-0 left-0 z-40 w-72 bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-800 flex flex-col justify-between transition-transform duration-200 md:static md:translate-x-0 ${
              mobileDrawerOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
            }`}>
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white">Recent chats</h3>
                  <button
                    onClick={() => setMobileDrawerOpen(false)}
                    className="md:hidden w-6 h-6 rounded-lg text-slate-400 text-xs"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-1">
                  {/* Current Active Partner */}
                  <div className="p-3 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100/80 dark:border-indigo-900/50 flex items-center gap-3">
                    {renderAvatar(partner, "w-9 h-9")}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-900 dark:text-white truncate">{partner}</span>
                        <div className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#5b4df2]"></span>
                          <span className="text-[10px] text-[#5b4df2] font-semibold">Active</span>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300 font-semibold truncate mt-0.5">
                        {msgs.length > 0 ? (msgs[msgs.length - 1].type === "image" ? "📷 Sent a photo" : msgs[msgs.length - 1].type === "audio" ? "🎙️ Voice message" : msgs[msgs.length - 1].text) : "Matched on " + (common[0] || "Music")}
                      </p>
                    </div>
                  </div>

                  {/* Real past matches only (Empty state if none yet) */}
                  {historyList.filter(h => h.partner_name !== partner).length === 0 ? (
                    <div className="py-8 px-2 text-center space-y-1">
                      <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">No other past chats</p>
                      <p className="text-[11px] text-slate-400">
                        Other people you connect with will be listed here.
                      </p>
                    </div>
                  ) : (
                    historyList
                      .filter(h => h.partner_name !== partner)
                      .slice(0, 5)
                      .map((h) => (
                        <div
                          key={h.id}
                          onClick={() => {
                            setPartner(h.partner_name);
                            setMobileDrawerOpen(false);
                          }}
                          className="p-3 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-center gap-3 cursor-pointer"
                        >
                          {renderAvatar(h.partner_name, "w-9 h-9")}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">{h.partner_name}</span>
                              <span className="text-[10px] text-slate-400">
                                {new Date(h.matched_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 truncate mt-0.5">
                              {h.last_message || (h.common_interests ? h.common_interests[0] : "Past chat")}
                            </p>
                          </div>
                        </div>
                      ))
                  )}
                </div>
              </div>

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

            {/* Mobile Drawer Backdrop */}
            {mobileDrawerOpen && (
              <div
                onClick={() => setMobileDrawerOpen(false)}
                className="fixed inset-0 bg-black/40 z-30 md:hidden"
              />
            )}

            {/* 2. Center Column: Chat Conversation Stream */}
            <main className="flex-1 flex flex-col bg-white dark:bg-slate-900 overflow-hidden border-r border-slate-200/80 dark:border-slate-800">
              
              {/* Partner Top Header Bar */}
              <div className="h-16 px-4 md:px-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900 shrink-0">
                <div
                  onClick={() => setMobileProfileOpen(true)}
                  className="flex items-center gap-3 cursor-pointer lg:cursor-default"
                >
                  {renderAvatar(partner, "w-10 h-10")}
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white leading-tight">{partner}</h2>
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                      Matched on {common[0] || "Music"} · {partnerLocation}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!outgoingCallWaiting && !callDeclinedMessage && (
                    <button
                      onClick={requestVideoCall}
                      className="w-9 h-9 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-[#5b4df2] dark:text-indigo-400 flex items-center justify-center transition-colors cursor-pointer"
                      title="Request video call"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                      </svg>
                    </button>
                  )}

                  {outgoingCallWaiting && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#5b4df2]/40 bg-indigo-50/50 dark:bg-indigo-950/50 text-[#5b4df2] dark:text-indigo-400 text-xs font-semibold">
                      <span className="w-2 h-2 rounded-full bg-[#5b4df2] animate-ping"></span>
                      <span>Calling…</span>
                      <button
                        onClick={cancelCallRequest}
                        className="ml-1 text-[11px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-bold"
                      >
                        ✕
                      </button>
                    </div>
                  )}

                  {callDeclinedMessage && (
                    <span className="px-3 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs font-semibold animate-in fade-in">
                      {callDeclinedMessage}
                    </span>
                  )}

                  <button
                    onClick={() => setShowReportModal(true)}
                    className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center transition-colors cursor-pointer text-sm font-bold"
                    title="Report or block"
                  >
                    •••
                  </button>
                </div>
              </div>

              {/* Chat Message Feed */}
              <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-4 bg-[#fafafa] dark:bg-[#0b0f19]">
                <div className="text-center my-2">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 px-3.5 py-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs font-medium">
                    Matched on {common[0] || "Music"} · Temporary session memory
                  </span>
                </div>

                {/* Icebreaker Row (Shown when no messages yet) */}
                {msgs.length === 0 && (
                  <div className="py-4 space-y-2 text-center animate-in fade-in">
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                      Break the ice without pressure:
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2 max-w-md mx-auto">
                      {getIcebreakers(common).map((starter) => (
                        <button
                          key={starter}
                          onClick={() => send(starter)}
                          className="px-3.5 py-2 rounded-2xl bg-white dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 border border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium text-left transition-all cursor-pointer shadow-2xs min-h-[44px]"
                        >
                          &ldquo;{starter}&rdquo;
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Messages list with Text, Image, and Audio rendering */}
                {msgs.map((m, i) => (
                  <div key={i} className={`flex items-end gap-2 ${m.mine ? "justify-end" : "justify-start"}`}>
                    {!m.mine && renderAvatar(partner, "w-7 h-7 text-xs")}
                    <div className="flex flex-col space-y-1 max-w-[85%] sm:max-w-md">
                      {!m.mine && (
                        <span className="text-[10px] text-slate-400 font-semibold px-1">{partner}</span>
                      )}

                      {/* 1. Text Message */}
                      {(!m.type || m.type === "text") && (
                        <div
                          className={`px-4 py-2.5 rounded-2xl text-xs sm:text-sm leading-relaxed break-words shadow-2xs ${
                            m.mine
                              ? "bg-[#5b4df2] text-white rounded-tr-xs"
                              : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700 rounded-tl-xs"
                          }`}
                        >
                          {m.text}
                        </div>
                      )}

                      {/* 2. Image Message */}
                      {m.type === "image" && m.mediaUrl && (
                        <div
                          onClick={() => setEnlargedImage(m.mediaUrl!)}
                          className={`p-1 rounded-2xl overflow-hidden cursor-pointer shadow-2xs max-w-xs transition-transform active:scale-98 ${
                            m.mine ? "bg-[#5b4df2] rounded-tr-xs" : "bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 rounded-tl-xs"
                          }`}
                        >
                          <img
                            src={m.mediaUrl}
                            alt="Chat attachment"
                            className="w-full h-auto max-h-64 object-cover rounded-xl"
                          />
                        </div>
                      )}

                      {/* 3. Audio / Voice Note Message */}
                      {m.type === "audio" && m.mediaUrl && (
                        <div
                          className={`px-3 py-2 rounded-2xl shadow-2xs flex items-center gap-2.5 min-w-[200px] ${
                            m.mine
                              ? "bg-[#5b4df2] text-white rounded-tr-xs"
                              : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700 rounded-tl-xs"
                          }`}
                        >
                          <span className="text-base">🎙️</span>
                          <div className="flex-1">
                            <audio
                              controls
                              src={m.mediaUrl}
                              className="w-48 h-8 max-w-full accent-[#5b4df2]"
                            />
                          </div>
                        </div>
                      )}

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
                      className="px-4 py-2 rounded-xl bg-[#5b4df2] hover:bg-[#4d3fe0] text-white text-xs font-semibold shadow-xs transition-all cursor-pointer min-h-[44px]"
                    >
                      Find next person
                    </button>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Composer: Input + Photo upload + Voice note + Send */}
              <div className="p-3 sm:p-4 bg-white dark:bg-slate-900 border-t border-slate-200/80 dark:border-slate-800 space-y-3">
                
                {/* Active Voice Recording Bar */}
                {isRecordingAudio ? (
                  <div className="flex items-center justify-between gap-3 bg-rose-50 dark:bg-rose-950/40 rounded-2xl px-4 py-2.5 border border-rose-200 dark:border-rose-900/60 animate-in fade-in">
                    <div className="flex items-center gap-2.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse"></span>
                      <span className="text-xs font-bold text-rose-700 dark:text-rose-300">
                        Recording audio… {formatTimer(recordingSeconds)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={cancelRecordingAudio}
                        className="py-1 px-3 rounded-xl bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 text-xs font-semibold hover:bg-rose-100 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={stopAndSendRecording}
                        className="py-1 px-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-xs transition-colors"
                      >
                        Send Audio
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 rounded-2xl px-3 py-2 border border-slate-200 dark:border-slate-700 focus-within:border-[#5b4df2] focus-within:bg-white dark:focus-within:bg-slate-800 transition-all">
                    
                    {/* Photo upload button */}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-8 h-8 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 flex items-center justify-center transition-colors cursor-pointer text-base"
                      title="Send image"
                      aria-label="Send photo"
                    >
                      📷
                    </button>

                    {/* Voice recording button */}
                    <button
                      onClick={startRecordingAudio}
                      className="w-8 h-8 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 flex items-center justify-center transition-colors cursor-pointer text-base"
                      title="Record voice message"
                      aria-label="Record voice message"
                    >
                      🎙️
                    </button>

                    {/* Text Input */}
                    <input
                      type="text"
                      className="flex-1 bg-transparent text-base sm:text-sm text-slate-800 dark:text-white placeholder-slate-400 outline-none min-h-[40px] px-1"
                      placeholder={`Write a message to ${partner}…`}
                      disabled={phase === "ended"}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && send()}
                    />

                    {/* Send Button */}
                    <button
                      onClick={() => send()}
                      disabled={phase === "ended" || !draft.trim()}
                      className="w-9 h-9 rounded-full bg-[#5b4df2] hover:bg-[#4d3fe0] disabled:opacity-30 disabled:hover:bg-[#5b4df2] text-white flex items-center justify-center transition-all cursor-pointer shadow-xs shrink-0"
                      aria-label="Send message"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                    </button>
                  </div>
                )}

                {/* Sticky Mobile Actions Row (44px target sizes) */}
                <div className="flex lg:hidden items-center justify-between gap-2 pt-1">
                  {friendStatus === "none" && (
                    <button
                      onClick={sendFriendRequest}
                      className="flex-1 py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors min-h-[44px]"
                    >
                      <span>+ Friend</span>
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
                    onClick={() => setShowReportModal(true)}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors min-h-[44px]"
                  >
                    <span>Report</span>
                  </button>

                  <button
                    onClick={next}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 hover:bg-rose-100 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer min-h-[44px]"
                  >
                    <span>Next person</span>
                  </button>
                </div>
              </div>
            </main>

            {/* 3. Right Sidebar: Stranger Profile & Actions (Desktop) */}
            <aside className="w-80 bg-white dark:bg-slate-900 p-6 hidden lg:flex flex-col justify-between shrink-0">
              <div className="space-y-6">
                <div className="text-center space-y-2">
                  <div className="w-20 h-20 mx-auto">
                    {renderAvatar(partner, "w-20 h-20 text-3xl")}
                  </div>
                  <div>
                    <div className="flex items-center justify-center gap-1.5">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">{partner}</h3>
                      {partnerIsMember ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 text-[#5b4df2] dark:text-indigo-300" title="Verified Member">
                          <span>✓</span> Member
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400" title="Guest: temporary session name">
                          Guest
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">{partnerLocation}</p>
                    {friendStatus === "friends" && partnerHandle && (
                      <div className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-xs font-mono font-bold">
                        <span>@{partnerHandle}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-800 text-left space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Identity
                  </span>
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    {partnerIsMember ? "Verified Account Member" : "Anonymous Guest"}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    {partnerIsMember
                      ? "This chatter has a registered handle. Handles remain private until mutual friendship is accepted."
                      : "Guest handles are temporary and released when the chat ends. No profile is stored."}
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/50 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Shared Signal
                  </span>
                  <div className="text-xs font-bold text-slate-900 dark:text-white">
                    {common[0] || "Music"}
                  </div>
                </div>

                <div className="space-y-2.5">
                  {friendStatus === "none" && (
                    <button
                      onClick={sendFriendRequest}
                      className="w-full py-2.5 px-4 rounded-xl bg-[#5b4df2] hover:bg-[#4d3fe0] text-white text-xs font-semibold shadow-2xs transition-all cursor-pointer flex items-center justify-center gap-1.5 min-h-[44px]"
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
                    className="w-full py-2.5 px-4 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20 hover:bg-rose-50 text-rose-600 dark:text-rose-400 text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5 min-h-[44px]"
                  >
                    <span>🛡</span> Report or block
                  </button>
                </div>
              </div>

              <button
                onClick={next}
                className="w-full py-3 px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold transition-all shadow-2xs flex items-center justify-center gap-2 cursor-pointer min-h-[44px]"
              >
                <span>Next person</span>
                <span>→</span>
              </button>
            </aside>

            {/* Mobile Profile Bottom Sheet */}
            {mobileProfileOpen && (
              <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm lg:hidden animate-in fade-in">
                <div className="w-full rounded-t-3xl bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-6 space-y-5 animate-in slide-in-from-bottom">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Stranger details</span>
                    <button onClick={() => setMobileProfileOpen(false)} className="text-slate-400 text-sm">✕</button>
                  </div>
                  <div className="text-center space-y-2">
                    <div className="w-16 h-16 mx-auto">{renderAvatar(partner, "w-16 h-16 text-2xl")}</div>
                    <div className="flex items-center justify-center gap-1.5">
                      <h3 className="text-base font-bold text-slate-900 dark:text-white">{partner}</h3>
                      {partnerIsMember ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950 text-[#5b4df2] dark:text-indigo-300">
                          ✓ Member
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500">
                          Guest
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">{partnerLocation}</p>
                    {friendStatus === "friends" && partnerHandle && (
                      <div className="mt-1 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-xs font-mono font-bold">
                        @{partnerHandle}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setMobileProfileOpen(false);
                      setShowReportModal(true);
                    }}
                    className="w-full py-3 rounded-xl border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-xs font-semibold"
                  >
                    Report or block
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
