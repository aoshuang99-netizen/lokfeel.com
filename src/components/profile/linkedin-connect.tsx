"use client";

import { useState } from "react";
import { Check, X, Loader2, ExternalLink } from "lucide-react";
import { useApiPost, useApiDelete } from "@/hooks/use-api";

interface LinkedInConnectProps {
  isVerified: boolean;
  occupation?: string;
  company?: string;
  industry?: string;
  onUpdate?: () => void;
}

export function LinkedInConnect({
  isVerified,
  occupation,
  company,
  industry,
  onUpdate,
}: LinkedInConnectProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const { post, isLoading: isLinking } = useApiPost();
  const { delete: disconnect, isLoading: isDisconnecting } = useApiDelete();

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      // Open LinkedIn OAuth popup
      const popup = window.open(
        "about:blank",
        "linkedin-oauth",
        "width=600,height=700,scrollbars=yes"
      );

      // Get auth URL from backend
      const response = await fetch("/api/auth/linkedin");
      const data = await response.json();

      if (data.authUrl && popup) {
        popup.location.href = data.authUrl;

        // Listen for callback message
        const handleMessage = async (event: MessageEvent) => {
          if (event.origin !== window.location.origin) return;
          if (event.data.type === "LINKEDIN_CALLBACK") {
            window.removeEventListener("message", handleMessage);
            popup?.close();

            // Exchange code for verification
            const result = await post("/api/auth/linkedin/callback", {
              code: event.data.code,
              state: event.data.state,
            });

            if (result) {
              onUpdate?.();
            }
            setIsConnecting(false);
          }
        };

        window.addEventListener("message", handleMessage);

        // Timeout after 5 minutes
        setTimeout(() => {
          window.removeEventListener("message", handleMessage);
          popup?.close();
          setIsConnecting(false);
        }, 300000);
      } else {
        popup?.close();
        setIsConnecting(false);
      }
    } catch (error) {
      console.error("LinkedIn connect error:", error);
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    const confirmed = confirm("Disconnect your LinkedIn profile?");
    if (!confirmed) return;

    const result = await disconnect("/api/auth/linkedin");
    if (result) {
      onUpdate?.();
    }
  };

  if (isVerified) {
    return (
      <div className="glass-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#0A66C2]/20 flex items-center justify-center">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-white">LinkedIn Verified</h3>
                <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 text-xs flex items-center gap-1">
                  <Check className="w-3 h-3" /> Verified
                </span>
              </div>
              {(occupation || company) && (
                <p className="text-sm text-white/60">
                  {occupation}
                  {occupation && company && " at "}
                  {company}
                  {industry && ` • ${industry}`}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={handleDisconnect}
            disabled={isDisconnecting}
            className="p-2 rounded-lg hover:bg-white/10 text-white/40 hover:text-red-400 transition-colors"
            title="Disconnect"
          >
            {isDisconnecting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <X className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center">
            <svg className="w-5 h-5 text-white/40" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
          </div>
          <div>
            <h3 className="font-semibold text-white">LinkedIn Profile</h3>
            <p className="text-sm text-white/60">
              Verify your professional identity
            </p>
          </div>
        </div>
        <button
          onClick={handleConnect}
          disabled={isConnecting || isLinking}
          className="py-2 px-4 rounded-xl bg-[#0A66C2] text-white font-medium flex items-center gap-2 hover:bg-[#0958a8] transition-colors disabled:opacity-50"
        >
          {isConnecting || isLinking ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
              Connect
            </>
          )}
        </button>
      </div>
      <p className="text-xs text-white/40 mt-3">
        Connecting your LinkedIn adds a verification badge to your profile and helps build trust with potential matches.
      </p>
    </div>
  );
}
