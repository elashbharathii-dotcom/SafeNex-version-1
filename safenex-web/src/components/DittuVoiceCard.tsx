import React, { useState, useRef } from 'react';
import { Mic, MicOff, Sparkles, Languages } from 'lucide-react';
import { dittuAIService } from '../services/ai/DITTUAIService';
import { LocationState } from '../types';

interface DittuVoiceCardProps {
  onTriggerSos: (source: string) => void;
  onCallGuardian: () => void;
  onQueryLocation: () => void;
  location?: LocationState;
  isEmergencyActive?: boolean;
  batteryLevel?: number | null;
  primaryGuardianName?: string;
}

export const DittuVoiceCard: React.FC<DittuVoiceCardProps> = ({
  onTriggerSos,
  onCallGuardian,
  onQueryLocation,
  location,
  isEmergencyActive = false,
  batteryLevel,
  primaryGuardianName,
}) => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('DITTU Bilingual AI Assistant standby. Speak in English or தமிழ்.');
  const [detectedLang, setDetectedLang] = useState<'en' | 'ta'>('en');
  const [lastIntent, setLastIntent] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const recognitionRef = useRef<any>(null);

  const speak = (msg: string, lang: 'en' | 'ta' = 'en') => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(msg);
      u.rate = 1.0;
      u.pitch = 1.0;
      u.lang = lang === 'ta' ? 'ta-IN' : 'en-US';
      window.speechSynthesis.speak(u);
    }
  };

  const handleCommand = async (rawText: string) => {
    if (!rawText.trim()) return;
    setTranscript(`"${rawText}"`);
    setIsProcessing(true);

    try {
      const result = await dittuAIService.processVoiceCommand(
        rawText,
        location,
        isEmergencyActive,
        batteryLevel,
        primaryGuardianName
      );

      setDetectedLang(result.detectedLanguage);
      setLastIntent(result.intent);
      setTranscript(`"${rawText}" → ${result.spokenReply}`);

      // Speak response in detected language
      speak(result.spokenReply, result.detectedLanguage);

      // Execute intent action
      if (result.shouldTriggerEmergency || result.intent === 'SOS_TRIGGER') {
        onTriggerSos('DITTU_AI_VOICE');
      } else if (result.intent === 'CALL_GUARDIAN') {
        onCallGuardian();
      } else if (result.intent === 'QUERY_LOCATION') {
        onQueryLocation();
      }
    } catch (e) {
      console.warn('[DittuVoiceCard] Error processing voice query:', e);
      // Fallback
      if (rawText.toLowerCase().includes('help') || rawText.includes('காப்பாத்து')) {
        speak('Emergency detected. Triggering SOS.', 'en');
        onTriggerSos('VOICE_FALLBACK');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleListening = () => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRec) {
      setTranscript('Speech recognition is not supported in this browser. Use manual buttons.');
      return;
    }

    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      setTranscript('Voice assistant standby.');
      return;
    }

    try {
      const recognition = new SpeechRec();
      recognition.continuous = false;
      recognition.interimResults = true;
      // Many modern engines handle both or default to en-US / locale
      recognition.lang = detectedLang === 'ta' ? 'ta-IN' : 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
        setTranscript(detectedLang === 'ta' ? 'கேட்கிறது... ("உதவி", "காப்பாத்துங்க", "எங்க இருக்கேன்")...' : 'Listening for "HELP!", "Call Guardian", "Where am I"...');
      };

      recognition.onresult = (event: any) => {
        const last = event.results.length - 1;
        const text = event.results[last][0].transcript;
        if (event.results[last].isFinal) {
          handleCommand(text);
        } else {
          setTranscript(`Listening: "${text}"`);
        }
      };

      recognition.onerror = (e: any) => {
        console.warn('Speech recognition error:', e.error);
        setIsListening(false);
        if (e.error === 'not-allowed') {
          setTranscript('Microphone permission denied. Please allow microphone access or use manual SOS.');
        } else if (e.error === 'network') {
          setTranscript('Internet unavailable. Browser speech-to-text requires network. Manual SOS works 100% offline.');
        } else {
          setTranscript('Voice recognition paused. Tap mic to restart.');
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (e) {
      console.warn('Speech recognition start failed:', e);
      setIsListening(false);
    }
  };

  return (
    <div className="glass-panel rounded-3xl p-5 border border-[#24434A] shadow-card flex flex-col justify-between">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2.5">
          <div className={`p-2.5 rounded-xl border ${
            isListening
              ? 'bg-[#00E6A0]/15 border-[#00E6A0] text-[#00E6A0]'
              : 'bg-[#142B35] border-[#24434A] text-[#708792]'
          }`}>
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-bold text-[#F4FAFA] tracking-wide">
                DITTU AI VOICE ASSISTANT
              </h4>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-[#35DDF2]/15 text-[#35DDF2] border border-[#35DDF2]/30">
                {detectedLang === 'ta' ? 'தமிழ்' : 'EN'}
              </span>
              {lastIntent && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-[#00E6A0]/15 text-[#00E6A0]">
                  {lastIntent}
                </span>
              )}
            </div>
            <p className="text-[11px] text-[#A2B5BF]">Bilingual emergency AI (English & தமிழ்)</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setDetectedLang(prev => prev === 'en' ? 'ta' : 'en')}
            className="p-2 rounded-xl bg-[#142B35] border border-[#24434A] text-[11px] text-[#A2B5BF] hover:text-[#35DDF2] transition"
            title="Switch Language (English / தமிழ்)"
          >
            <Languages className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={toggleListening}
            className={`p-2.5 rounded-full border transition cursor-pointer ${
              isListening
                ? 'bg-[#FF304F] text-white border-[#FF304F] shadow-lg animate-pulse'
                : 'bg-[#142B35] text-[#A2B5BF] border-[#24434A] hover:border-[#00E6A0]/40'
            }`}
            title={isListening ? 'Stop listening' : 'Start voice recognition'}
          >
            {isListening ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Waveform / Visualizer */}
      <div className="my-2 p-3 rounded-2xl bg-[#0B151D]/90 border border-[#24434A] flex flex-col items-center justify-center min-h-[64px]">
        {isListening ? (
          <div className="flex items-center gap-1.5 h-6">
            <span className="w-1 bg-[#00E6A0] rounded-full animate-[pulse_0.4s_ease-in-out_infinite] h-5" />
            <span className="w-1 bg-[#35DDF2] rounded-full animate-[pulse_0.6s_ease-in-out_infinite] h-8" />
            <span className="w-1 bg-[#78FFD0] rounded-full animate-[pulse_0.3s_ease-in-out_infinite] h-4" />
            <span className="w-1 bg-[#00E6A0] rounded-full animate-[pulse_0.5s_ease-in-out_infinite] h-7" />
            <span className="w-1 bg-[#35DDF2] rounded-full animate-[pulse_0.7s_ease-in-out_infinite] h-5" />
          </div>
        ) : isProcessing ? (
          <div className="flex items-center gap-2 text-xs text-[#35DDF2]">
            <Sparkles className="w-3.5 h-3.5 animate-spin" />
            <span>DITTU AI Reasoning...</span>
          </div>
        ) : (
          <p className="text-xs font-mono text-[#A2B5BF] text-center line-clamp-2">
            {transcript}
          </p>
        )}
      </div>

      {/* Trigger Pills - English and Tamil */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mt-2">
        <button
          onClick={() => handleCommand('help')}
          className="py-1.5 px-2 rounded-xl bg-[#FF304F]/10 hover:bg-[#FF304F]/20 border border-[#FF304F]/20 text-[11px] font-semibold text-[#FF304F] transition text-center"
        >
          Say "HELP!"
        </button>
        <button
          onClick={() => handleCommand('காப்பாத்துங்க')}
          className="py-1.5 px-2 rounded-xl bg-[#FF304F]/10 hover:bg-[#FF304F]/20 border border-[#FF304F]/20 text-[11px] font-semibold text-[#FF304F] transition text-center"
        >
          "காப்பாத்துங்க"
        </button>
        <button
          onClick={() => handleCommand('where am i')}
          className="py-1.5 px-2 rounded-xl bg-[#142B35] hover:bg-[#1A3644] border border-[#24434A] text-[11px] font-semibold text-[#A2B5BF] hover:text-[#35DDF2] transition text-center"
        >
          "Where am I"
        </button>
        <button
          onClick={() => handleCommand('எங்க இருக்கேன்')}
          className="py-1.5 px-2 rounded-xl bg-[#142B35] hover:bg-[#1A3644] border border-[#24434A] text-[11px] font-semibold text-[#A2B5BF] hover:text-[#35DDF2] transition text-center"
        >
          "எங்க இருக்கேன்"
        </button>
      </div>
    </div>
  );
};
