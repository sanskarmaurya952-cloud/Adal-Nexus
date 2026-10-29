import React, { useEffect, useRef, useState, useCallback } from "react";
import { MicOffIcon, MicrophoneIcon, SparklesIcon } from "../Icons";

export type VoiceLanguage = "en-IN" | "hi-IN" | "en-US";

export type VoiceState = "idle" | "listening" | "processing" | "understood" | "completed" | "error";

interface VoiceControlProps {
  onTranscript: (text: string, shouldExecute?: boolean) => void;
  disabled?: boolean;
  className?: string;
  showQuickChips?: boolean;
  onChipSelect?: (cmd: string) => void;
}

export function VoiceControl({
  onTranscript,
  disabled = false,
  className = "",
  showQuickChips = true,
  onChipSelect,
}: VoiceControlProps) {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [language, setLanguage] = useState<VoiceLanguage>("en-IN");
  const [interimText, setInterimText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasSpeechSupport, setHasSpeechSupport] = useState<boolean>(true);
  const [showTroubleshoot, setShowTroubleshoot] = useState<boolean>(false);

  const recognitionRef = useRef<any>(null);

  // Initialize SpeechRecognition support check
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setHasSpeechSupport(false);
    }
  }, []);

  const requestMicAccess = useCallback(async () => {
    if (navigator?.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        return true;
      } catch (err: any) {
        console.warn("[VoiceControl] getUserMedia access error:", err);
        return false;
      }
    }
    return true;
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    setVoiceState((prev) => (prev === "listening" ? "processing" : prev));
  }, []);

  const startListening = useCallback(async () => {
    setErrorMessage(null);
    setInterimText("");

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setHasSpeechSupport(false);
      setErrorMessage(
        "Web Speech Recognition is not available in this window. You can type commands or click sample voice chips below."
      );
      setVoiceState("error");
      return;
    }

    // Preflight getUserMedia to request device permissions if not yet cached
    await requestMicAccess();

    try {
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.lang = language;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setVoiceState("listening");
        setErrorMessage(null);
        setShowTroubleshoot(false);
      };

      recognition.onresult = (event: any) => {
        let final = "";
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            final += transcript;
          } else {
            interim += transcript;
          }
        }

        const currentText = (final || interim).trim();
        setInterimText(currentText);

        if (final.trim()) {
          setVoiceState("understood");
          onTranscript(final.trim(), false);
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error === "no-speech") {
          setErrorMessage("No speech detected. Please speak clearly into your microphone.");
        } else if (event.error === "not-allowed") {
          setErrorMessage(
            "Microphone permission was denied. Please allow microphone access in system/browser settings."
          );
          setShowTroubleshoot(true);
        } else if (event.error === "network") {
          setErrorMessage(
            "Speech recognition network unavailable. You can click sample voice chips or type your command."
          );
        } else {
          setErrorMessage(`Speech recognition error: ${event.error}`);
        }
        setVoiceState("error");
      };

      recognition.onend = () => {
        setVoiceState((prev) => {
          if (prev === "listening" || prev === "processing") {
            return "idle";
          }
          return prev;
        });
      };

      recognition.start();
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to start speech recognition.");
      setVoiceState("error");
    }
  }, [language, onTranscript, requestMicAccess]);

  const toggleListening = () => {
    if (voiceState === "listening") {
      stopListening();
    } else {
      startListening();
    }
  };

  // Keyboard shortcut: Alt+M to start/stop voice input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "m" || e.key === "M")) {
        e.preventDefault();
        toggleListening();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleListening]);

  const sampleCommands = [
    { label: "YouTube Kholo", cmd: "YouTube kholo", lang: "Hinglish" },
    { label: "Play Arijit Singh on YouTube", cmd: "YouTube par Arijit Singh ka song play karo", lang: "Hinglish" },
    { label: "Naya Tab & Google", cmd: "Naya tab kholo aur Google kholo", lang: "Hinglish" },
    { label: "Pichhle Tab Par Jao", cmd: "Pichhle tab par jao", lang: "Hinglish" },
    { label: "Search Python on Google", cmd: "Google par Python tutorials search karo", lang: "Hinglish" },
    { label: "Website Refresh Karo", cmd: "Is website ko refresh karo", lang: "Hinglish" },
    { label: "Social Media Demo Kholo", cmd: "Adal Nexus mein social media demo kholo", lang: "Hinglish" },
    { label: "Pause Media", cmd: "Video pause karo", lang: "Hinglish" },
  ];

  return (
    <div className={`voice-control-container ${className}`}>
      {/* Top Controls: Push-to-Talk Mic Button, Status Label, Language Switcher */}
      <div className="voice-control-row">
        <button
          type="button"
          onClick={toggleListening}
          disabled={disabled}
          className={`voice-mic-btn ${voiceState === "listening" ? "listening-pulse" : ""} ${
            voiceState === "error" ? "error-btn" : ""
          }`}
          title={voiceState === "listening" ? "Click to Stop Listening (Alt+M)" : "Click to Speak (Alt+M)"}
          aria-label="Voice Command Microphone"
        >
          {voiceState === "listening" ? (
            <div className="mic-active-inner">
              <MicrophoneIcon size={20} className="mic-icon animate-pulse" />
              <span className="mic-glow-ring" />
            </div>
          ) : voiceState === "error" ? (
            <MicOffIcon size={20} className="mic-icon error" />
          ) : (
            <MicrophoneIcon size={20} className="mic-icon" />
          )}
        </button>

        <div className="voice-feedback-meta">
          <div className="voice-status-line">
            {voiceState === "listening" && (
              <span className="voice-status-badge listening">
                <span className="dot-blink" />
                Listening... (Bolna shuru karein)
              </span>
            )}
            {voiceState === "processing" && (
              <span className="voice-status-badge processing">Processing speech...</span>
            )}
            {voiceState === "understood" && (
              <span className="voice-status-badge understood">✓ Command understood</span>
            )}
            {voiceState === "error" && (
              <span className="voice-status-badge error">Voice feedback error</span>
            )}
            {voiceState === "idle" && (
              <span className="voice-status-badge idle">
                Voice Ready · Click Mic or press <kbd>Alt+M</kbd>
              </span>
            )}
          </div>

          {/* Animated audio bars during listening */}
          {voiceState === "listening" && (
            <div className="voice-waveform-bars">
              <span className="wave-bar bar-1" />
              <span className="wave-bar bar-2" />
              <span className="wave-bar bar-3" />
              <span className="wave-bar bar-4" />
              <span className="wave-bar bar-5" />
            </div>
          )}

          {interimText && voiceState === "listening" && (
            <p className="voice-interim-preview">"{interimText}"</p>
          )}
        </div>

        {/* Language Selector: Hindi / Hinglish / English */}
        <div className="voice-lang-switch">
          <button
            type="button"
            className={`voice-lang-pill ${language === "en-IN" ? "active" : ""}`}
            onClick={() => setLanguage("en-IN")}
            title="Hinglish / Indian English"
          >
            Hinglish
          </button>
          <button
            type="button"
            className={`voice-lang-pill ${language === "hi-IN" ? "active" : ""}`}
            onClick={() => setLanguage("hi-IN")}
            title="Hindi (हिन्दी)"
          >
            हिन्दी
          </button>
          <button
            type="button"
            className={`voice-lang-pill ${language === "en-US" ? "active" : ""}`}
            onClick={() => setLanguage("en-US")}
            title="English (US)"
          >
            English
          </button>
        </div>
      </div>

      {/* Error alert if permission denied or unavailable */}
      {errorMessage && (
        <div className="voice-error-alert" role="alert">
          <div className="voice-error-text">
            <span>{errorMessage}</span>
          </div>
          <div className="voice-error-actions">
            <button
              type="button"
              className="voice-retry-btn"
              onClick={() => {
                setErrorMessage(null);
                startListening();
              }}
              title="Retry microphone permission"
            >
              🔄 Retry Mic
            </button>
            <button
              type="button"
              className="voice-troubleshoot-toggle-btn"
              onClick={() => setShowTroubleshoot((prev) => !prev)}
            >
              {showTroubleshoot ? "Hide Guide" : "⚙️ How to Fix"}
            </button>
            <button
              type="button"
              className="voice-dismiss-err-btn"
              onClick={() => setErrorMessage(null)}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Windows Microphone Setup Guide (Bilingual Hindi + English) */}
      {showTroubleshoot && (
        <div className="voice-troubleshoot-guide">
          <div className="voice-guide-header">
            <strong>🎙️ Windows Microphone Permission Kaise Allow Karein:</strong>
          </div>
          <ol className="voice-guide-steps">
            <li>
              Keyboard par <kbd>Win + I</kbd> dabayein (Windows Settings open hoga).
            </li>
            <li>
              <strong>Privacy & security</strong> (गोपनीयता और सुरक्षा) ➔ <strong>Microphone</strong> (माइक्रोफ़ोन) par click karein.
            </li>
            <li>
              Dekhein ki <strong>"Microphone access"</strong> ka toggle <strong>ON</strong> hai.
            </li>
            <li>
              Neeche scroll karein aur <strong>"Let desktop apps access your microphone"</strong> ko bhi <strong>ON</strong> rakhein.
            </li>
            <li>
              Settings karne ke baad upar <strong>"🔄 Retry Mic"</strong> button dabayein!
            </li>
          </ol>
          <div className="voice-guide-tip">
            💡 <em>Tip: Agar aapke PC/laptop mein mic nahi hai, toh aap bina mic ke bhi seedhe neeche diye gaye voice command chips (jaise "YouTube kholo") par click kar sakte hain, wo bina mic ke turant execute honge!</em>
          </div>
        </div>
      )}

      {/* Quick Voice Prompt Chips (Hindi & English) */}
      {showQuickChips && (
        <div className="voice-quick-chips-wrapper">
          <div className="voice-chips-header">
            <SparklesIcon size={13} />
            <span>Try speaking or clicking a sample voice command:</span>
          </div>
          <div className="voice-chips-scroll">
            {sampleCommands.map((sc, i) => (
              <button
                key={i}
                type="button"
                className="voice-command-chip"
                onClick={() => {
                  onTranscript(sc.cmd, false);
                  if (onChipSelect) onChipSelect(sc.cmd);
                }}
                title={`Click to populate: "${sc.cmd}"`}
              >
                <span className="chip-label">{sc.cmd}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
