import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Lock, Share2, Volume2, VolumeX, Eye, EyeOff, Radio, Sparkles, Copy, Check, ShieldCheck } from 'lucide-react';
import { LocationState, Guardian, ThreatIntelligenceResult, IncidentAssessmentResult, EmergencyMessageResult } from '../types';
import { audioSiren } from '../services/audioSirenService';
import { supabaseService } from '../services/supabaseService';
import { securityManager } from '../lib/security';
import { APP_PUBLIC_URL } from '../lib/constants';

interface EmergencyActiveOverlayProps {
  isOpen: boolean;
  eventId: string;
  triggerSource: string;
  location: LocationState;
  onDisarm: () => void;
  primaryGuardian?: Guardian | null;
  threatAssessment?: ThreatIntelligenceResult | null;
  incidentAssessment?: IncidentAssessmentResult | null;
  emergencyMessages?: EmergencyMessageResult | null;
  guardianAcknowledged?: boolean;
}

export const EmergencyActiveOverlay: React.FC<EmergencyActiveOverlayProps> = ({
  isOpen,
  eventId,
  triggerSource,
  location,
  onDisarm,
  primaryGuardian,
  threatAssessment,
  incidentAssessment,
  emergencyMessages,
  guardianAcknowledged = false,
}) => {
  const [pinDigits, setPinDigits] = useState<string[]>([]);
  const [pinError, setPinError] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [isSirenMuted, setIsSirenMuted] = useState(false);
  const [isStrobeDisabled, setIsStrobeDisabled] = useState(false);
  const [strobeFlash, setStrobeFlash] = useState(false);
  const [breadcrumbCount, setBreadcrumbCount] = useState(1);
  const [recordingStatus, setRecordingStatus] = useState('Initializing MediaRecorder...');
  const [copiedSms, setCopiedSms] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (!isOpen) {
      audioSiren.stopSiren();
      return;
    }

    // 1. Acoustic Siren
    if (!isSirenMuted) {
      audioSiren.startSiren();
    }

    // 2. Optical Tactical Strobe Flasher
    const strobeInterval = setInterval(() => {
      if (!isStrobeDisabled) {
        setStrobeFlash((prev) => !prev);
      }
    }, 180);

    // 3. Continuous GPS Breadcrumbs to Supabase table
    const breadcrumbInterval = setInterval(async () => {
      if (eventId && location.latitude && location.longitude) {
        await supabaseService.streamBreadcrumb(eventId, location);
        setBreadcrumbCount((c) => c + 1);
      }
    }, 3800);

    // 4. Blackbox Audio/Video capture
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then((stream) => {
          try {
            const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
            recordedChunksRef.current = [];
            recorder.ondataavailable = (e) => {
              if (e.data.size > 0) recordedChunksRef.current.push(e.data);
            };
            recorder.onstop = async () => {
              const fullBlob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
              const fileName = `evidence_${eventId}_${Date.now()}.webm`;
              setRecordingStatus('Uploading evidence to Supabase bucket...');
              const uploadedUrl = await supabaseService.uploadEvidence(eventId, fullBlob, fileName, 'video');
              if (uploadedUrl) {
                setRecordingStatus('Evidence securely encrypted & stored in Supabase');
              }
              stream.getTracks().forEach((track) => track.stop());
            };
            recorder.start(1000);
            mediaRecorderRef.current = recorder;
            setRecordingStatus('Live Audio/Video Recording active');
          } catch (e) {
            console.warn('MediaRecorder init error:', e);
            setRecordingStatus('Audio/Video capture unavailable');
          }
        })
        .catch((e) => {
          console.warn('Microphone/Camera permission blocked:', e);
          setRecordingStatus('Camera/Mic permission blocked');
        });
    } else {
      setRecordingStatus('Media recording not supported on this browser');
    }

    return () => {
      audioSiren.stopSiren();
      clearInterval(strobeInterval);
      clearInterval(breadcrumbInterval);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {}
      }
    };
  }, [isOpen, eventId, isSirenMuted, isStrobeDisabled, location]);

  if (!isOpen) return null;

  const handleDigit = async (digit: string) => {
    const remaining = securityManager.getLockoutRemainingSeconds();
    if (remaining > 0) {
      setLockoutSeconds(remaining);
      setPinError(true);
      return;
    }

    if (pinDigits.length < 4) {
      const next = [...pinDigits, digit];
      setPinDigits(next);
      setPinError(false);

      if (next.length === 4) {
        const entered = next.join('');
        const isValid = await securityManager.verifyPin(entered);

        if (isValid) {
          audioSiren.stopSiren();
          if (eventId) {
            await supabaseService.resolveEmergencyEvent(eventId);
          }
          onDisarm();
          setPinDigits([]);
          setLockoutSeconds(0);
        } else {
          const lockedSecs = securityManager.getLockoutRemainingSeconds();
          setLockoutSeconds(lockedSecs);
          setPinError(true);
          setTimeout(() => {
            setPinDigits([]);
            setPinError(false);
          }, 800);
        }
      }
    }
  };

  const handleDelete = () => setPinDigits((prev) => prev.slice(0, -1));
  const handleClear = () => setPinDigits([]);

  const toggleSiren = () => {
    if (isSirenMuted) {
      audioSiren.startSiren();
      setIsSirenMuted(false);
    } else {
      audioSiren.stopSiren();
      setIsSirenMuted(true);
    }
  };

  // WhatsApp Emergency Link for Primary Guardian
  const lat = location.latitude;
  const lng = location.longitude;
  const mapsUrl = (lat && lng) ? `https://maps.google.com/?q=${lat},${lng}` : 'Pending GPS lock';
  const trackingToken = localStorage.getItem('safenex_active_tracking_token');
  const trackUrl = trackingToken
    ? `${APP_PUBLIC_URL}/?track=${eventId}&token=${trackingToken}`
    : `${APP_PUBLIC_URL}/?track=${eventId}`;
  const whatsappMsg = encodeURIComponent(
    `🚨 *SAFENEX CRITICAL EMERGENCY ALERT*\nEmergency SOS has been triggered!\n\n📍 *Live Location*: ${mapsUrl}\n🛰️ *Incident Tracking ID*: ${eventId}\n🌐 *Portal*: ${trackUrl}\n\nPlease check on me immediately!`
  );

  const cleanPhone = primaryGuardian?.phone ? primaryGuardian.phone.replace(/[^0-9]/g, '') : null;
  const whatsappUrl = cleanPhone 
    ? `https://wa.me/${cleanPhone}?text=${whatsappMsg}`
    : `https://wa.me/?text=${whatsappMsg}`;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-between p-4 sm:p-6 overflow-y-auto">
      {/* Tactical Strobe Background */}
      <div
        className={`fixed inset-0 transition-opacity duration-75 pointer-events-none ${
          !isStrobeDisabled && strobeFlash
            ? 'bg-[#FF304F]/35 backdrop-brightness-125'
            : 'bg-[#070D12]/95 backdrop-blur-xl'
        }`}
      />

      {/* Top Banner */}
      <div className="relative z-10 w-full max-w-lg flex items-center justify-between p-4 rounded-2xl bg-[#142B35]/90 border border-[#FF304F] shadow-red-glow">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-[#FF304F] text-white animate-pulse">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-black text-white tracking-wider flex items-center gap-2">
              EMERGENCY ACTIVE
              <span className="w-2.5 h-2.5 rounded-full bg-[#FF304F] animate-ping" />
            </h2>
            <p className="text-xs text-[#FF304F] font-semibold">{triggerSource}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleSiren}
            title={isSirenMuted ? 'Unmute Siren' : 'Mute Siren'}
            className="p-2 rounded-xl bg-[#101F29] border border-[#24434A] text-[#F4FAFA] hover:text-[#FF304F]"
          >
            {isSirenMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-[#FF304F]" />}
          </button>
          <button
            onClick={() => setIsStrobeDisabled(!isStrobeDisabled)}
            title={isStrobeDisabled ? 'Enable Strobe' : 'Pause Strobe'}
            className="p-2 rounded-xl bg-[#101F29] border border-[#24434A] text-[#F4FAFA] hover:text-[#00E6A0]"
          >
            {isStrobeDisabled ? <EyeOff className="w-4 h-4 text-[#708792]" /> : <Eye className="w-4 h-4 text-[#00E6A0]" />}
          </button>
        </div>
      </div>

      {/* Telemetry & WhatsApp Dispatch */}
      <div className="relative z-10 w-full max-w-lg my-4 flex flex-col gap-3">
        <div className="p-4 rounded-2xl bg-[#101F29]/90 border border-[#24434A] text-xs">
          <div className="flex items-center justify-between text-[#A2B5BF] mb-2 font-mono">
            <span className="flex items-center gap-1.5 text-[#00E6A0]">
              <Radio className="w-3.5 h-3.5 animate-pulse" /> Live Breadcrumbs: #{breadcrumbCount}
            </span>
            <span>
              {lat && lng ? `${lat.toFixed(5)}°, ${lng.toFixed(5)}°` : 'Acquiring GPS...'}
            </span>
          </div>
          <p className="text-white font-medium truncate mb-2">
            {location.address || 'Streaming real-time coordinates to Supabase PostgreSQL'}
          </p>
          <div className="p-2 rounded-xl bg-[#0B151D] border border-[#24434A]/80 text-[11px] text-[#A2B5BF] flex items-center justify-between">
            <span className="truncate">{recordingStatus}</span>
            <span className="px-2 py-0.5 rounded bg-[#FF304F]/20 text-[#FF304F] font-bold">REC</span>
          </div>
        </div>

        {/* WhatsApp Dispatch Button */}
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full py-3 px-4 rounded-2xl bg-[#25D366] hover:bg-[#20ba5a] text-black font-extrabold text-xs flex items-center justify-center gap-2 shadow-lg transition"
        >
          <Share2 className="w-4 h-4" />
          <span>
            {primaryGuardian
              ? `Dispatch WhatsApp to Primary Guardian (${primaryGuardian.name})`
              : 'Dispatch Alert via WhatsApp'}
          </span>
        </a>

        {/* AI Emergency SMS Quick-Copy Button */}
        {emergencyMessages && (
          <button
            onClick={() => {
              navigator.clipboard.writeText(emergencyMessages.smsMessage);
              setCopiedSms(true);
              setTimeout(() => setCopiedSms(false), 2000);
            }}
            className="w-full py-2.5 px-4 rounded-2xl bg-[#142B35] hover:bg-[#1C3B4A] border border-[#24434A] text-[#F4FAFA] text-xs font-semibold flex items-center justify-center gap-2 transition"
          >
            {copiedSms ? <Check className="w-3.5 h-3.5 text-[#00E6A0]" /> : <Copy className="w-3.5 h-3.5 text-[#35DDF2]" />}
            <span>{copiedSms ? 'Verified Emergency SMS Copied!' : 'Copy AI-Verified Emergency SMS (160 chars)'}</span>
          </button>
        )}

        {/* Real-Time AI Threat Assessment Badge & Indicators */}
        {(threatAssessment || incidentAssessment) && (
          <div className="p-3.5 rounded-2xl bg-[#0B151D]/90 border border-[#24434A] text-xs">
            <div className="flex items-center justify-between mb-1.5">
              <span className="flex items-center gap-1.5 font-bold text-[#35DDF2]">
                <Sparkles className="w-3.5 h-3.5" />
                {threatAssessment?.uncertaintyExplanation?.toLowerCase().includes('heuristic') ||
                 threatAssessment?.uncertaintyExplanation?.toLowerCase().includes('client-side')
                  ? 'LOCAL SAFETY HEURISTICS'
                  : 'AI THREAT INTELLIGENCE'}
              </span>
              <div className="flex items-center gap-1.5">
                <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-mono font-bold border ${
                  threatAssessment?.uncertaintyExplanation?.toLowerCase().includes('heuristic') ||
                  threatAssessment?.uncertaintyExplanation?.toLowerCase().includes('client-side')
                    ? 'bg-[#FFB800]/15 text-[#FFB800] border-[#FFB800]/30'
                    : 'bg-[#35DDF2]/15 text-[#35DDF2] border-[#35DDF2]/30'
                }`}>
                  {threatAssessment?.uncertaintyExplanation?.toLowerCase().includes('heuristic') ||
                   threatAssessment?.uncertaintyExplanation?.toLowerCase().includes('client-side')
                    ? 'HEURISTIC FALLBACK'
                    : 'GEMINI 2.5 FLASH'}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-[#FF304F]/15 text-[#FF304F] border border-[#FF304F]/30 font-bold">
                  {threatAssessment?.incidentCategory || incidentAssessment?.severityLevel || 'EVALUATED'}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-[#A2B5BF] leading-relaxed mb-1.5">
              {threatAssessment?.incidentSummary || incidentAssessment?.situationalContext}
            </p>
            {threatAssessment && (
              <div className="flex items-center justify-between text-[10px] text-[#708792] font-mono">
                <span>Confidence: {Math.round(threatAssessment.confidenceLevel * 100)}%</span>
                <span className="truncate max-w-[220px]">{threatAssessment.uncertaintyExplanation}</span>
              </div>
            )}
            {guardianAcknowledged && (
              <div className="mt-2 pt-1.5 border-t border-[#24434A] flex items-center gap-1.5 text-[11px] text-[#00E6A0]">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Guardian acknowledgment confirmed</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cryptographic Disarm Keypad */}
      <div className="relative z-10 w-full max-w-xs p-5 rounded-3xl bg-[#101F29]/95 border border-[#24434A] shadow-card flex flex-col items-center">
        <div className="flex items-center gap-1.5 mb-2 text-xs font-bold text-[#A2B5BF]">
          <Lock className="w-3.5 h-3.5 text-[#00E6A0]" />
          <span>ENTER DISARM PIN</span>
        </div>

        {/* 4 PIN Dots */}
        <div className={`flex items-center gap-3 my-2 ${pinError ? 'animate-shake' : ''}`}>
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className={`w-3.5 h-3.5 rounded-full border transition-all ${
                pinDigits.length > idx
                  ? pinError
                    ? 'bg-[#FF304F] border-[#FF304F]'
                    : 'bg-[#00E6A0] border-[#00E6A0] shadow-[0_0_10px_#00E6A0]'
                  : 'bg-[#0B151D] border-[#24434A]'
              }`}
            />
          ))}
        </div>

        {pinError && (
          <span className="text-[11px] text-[#FF304F] font-bold my-1 text-center">
            {lockoutSeconds > 0
              ? `Locked out for ${lockoutSeconds}s. Too many failed attempts.`
              : 'Incorrect disarm PIN.'}
          </span>
        )}

        {/* Keypad Grid */}
        <div className="grid grid-cols-3 gap-2.5 w-full mt-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLR', '0', '⌫'].map((k) => (
            <button
              key={k}
              onClick={() => {
                if (k === 'CLR') handleClear();
                else if (k === '⌫') handleDelete();
                else handleDigit(k);
              }}
              className="py-3 rounded-2xl bg-[#142B35] hover:bg-[#1C3B4A] active:bg-[#00E6A0]/20 border border-[#24434A] text-sm font-bold text-[#F4FAFA] transition active:scale-95"
            >
              {k}
            </button>
          ))}
        </div>

        <p className="text-[10px] text-[#708792] mt-3">
          Salted SHA-256 verification disarms siren & closes cloud event.
        </p>
      </div>
    </div>
  );
};
