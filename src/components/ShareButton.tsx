"use client";

import { useState } from "react";
import { Share2, X, Link2, Check } from "lucide-react";

interface ShareButtonProps {
  url?: string;
  title?: string;
  description?: string;
  className?: string;
}

const defaultShareData = {
  title: "LokFee! - Meaningful Connections",
  description: "I just joined LokFee!! Check it out!",
};

export default function ShareButton({
  url = typeof window !== "undefined" ? window.location.href : "https://lokfeel.com",
  title = defaultShareData.title,
  description = defaultShareData.description,
  className = "",
}: ShareButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareData = { url, title, text: description };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setIsOpen(true);
        }
      }
    } else {
      setIsOpen(true);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shareLinks = [
    { name: "Facebook", icon: "📘", url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` },
    { name: "Twitter/X", icon: "🐦", url: `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(description)}` },
    { name: "LinkedIn", icon: "💼", url: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}` },
    { name: "Reddit", icon: "🔴", url: `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}` },
    { name: "WhatsApp", icon: "💬", url: `https://wa.me/?text=${encodeURIComponent(`${title}\n\n${url}`)}` },
    { name: "Telegram", icon: "✈️", url: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(description)}` },
  ];

  return (
    <>
      <button onClick={handleNativeShare} className={`btn-secondary flex items-center gap-2 ${className}`}>
        <Share2 className="w-4 h-4" />
        Share
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 w-full max-w-md animate-slide-up">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-foreground">Share LokFee!</h3>
              <button onClick={() => setIsOpen(false)} className="p-2 hover:bg-background-tertiary rounded-full">
                <X className="w-5 h-5 text-foreground-muted" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-6">
              {shareLinks.map((link) => (
                <button
                  key={link.name}
                  onClick={() => window.open(link.url, "_blank", "width=600,height=400")}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-background-tertiary transition-colors"
                >
                  <span className="text-2xl">{link.icon}</span>
                  <span className="text-xs text-foreground-muted">{link.name}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 p-3 bg-background-tertiary rounded-xl">
              <input
                type="text"
                value={url}
                readOnly
                className="flex-1 bg-transparent text-sm text-foreground-muted outline-none"
              />
              <button
                onClick={handleCopyLink}
                className="p-2 hover:bg-background-tertiary rounded-lg transition-colors"
              >
                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Link2 className="w-4 h-4 text-foreground-muted" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
