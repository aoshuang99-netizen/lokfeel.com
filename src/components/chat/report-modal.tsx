"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Flag, AlertTriangle, Check, Loader2 } from "lucide-react";

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportedUserId: string;
  reportedUserName: string;
  chatRoomId?: string;
}

const REPORT_REASONS = [
  { value: "INAPPROPRIATE_CONTENT", label: "Inappropriate Content", description: "Sexual, violent, or offensive content" },
  { value: "HARASSMENT", label: "Harassment", description: "Bullying, threats, or persistent unwanted contact" },
  { value: "FAKE_PROFILE", label: "Fake Profile", description: "Impersonating someone else or using false information" },
  { value: "SPAM", label: "Spam", description: "Unwanted promotional content or scams" },
  { value: "OFFENSIVE_BEHAVIOR", label: "Offensive Behavior", description: "Hate speech, discrimination, or abusive language" },
  { value: "OTHER", label: "Other", description: "Something else that concerns you" },
];

export function ReportModal({ isOpen, onClose, reportedUserId, reportedUserName, chatRoomId }: ReportModalProps) {
  const [selectedReason, setSelectedReason] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!selectedReason) return;

    setIsSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportedUserId,
          reason: selectedReason,
          description: description.trim() || undefined,
          chatRoomId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to submit report");
      }

      setIsSuccess(true);
      setTimeout(() => {
        onClose();
        // Reset state after close
        setTimeout(() => {
          setIsSuccess(false);
          setSelectedReason("");
          setDescription("");
        }, 300);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit report");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.8)" }}
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-md bg-[#111] rounded-2xl overflow-hidden"
          style={{ border: "1px solid rgba(255,255,255,0.1)" }}
          onClick={(e) => e.stopPropagation()}
        >
          {isSuccess ? (
            // Success State
            <div className="p-8 text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4"
              >
                <Check className="w-8 h-8 text-green-400" />
              </motion.div>
              <h3 className="text-xl font-semibold text-white mb-2">Report Submitted</h3>
              <p className="text-sm text-white/60">
                Thank you for helping keep our community safe. We&apos;ll review this report promptly.
              </p>
            </div>
          ) : (
            // Report Form
            <>
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <Flag className="w-5 h-5 text-red-400" />
                  <h3 className="text-lg font-semibold text-white">Report User</h3>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                >
                  <X className="w-5 h-5 text-white/70" />
                </button>
              </div>

              <div className="p-4 space-y-4">
                {/* Warning */}
                <div className="flex items-start gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-yellow-200/80">
                    You&apos;re reporting <strong>{reportedUserName}</strong>. This report will be reviewed by our team.
                  </p>
                </div>

                {/* Error */}
                {error && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <p className="text-sm text-red-300">{error}</p>
                  </div>
                )}

                {/* Reason Selection */}
                <div>
                  <label className="block text-sm font-medium text-white mb-3">
                    Why are you reporting this user? <span className="text-red-400">*</span>
                  </label>
                  <div className="space-y-2">
                    {REPORT_REASONS.map((reason) => (
                      <button
                        key={reason.value}
                        onClick={() => setSelectedReason(reason.value)}
                        className={`w-full p-3 rounded-xl border text-left transition-all ${
                          selectedReason === reason.value
                            ? "border-white bg-white/10"
                            : "border-white/10 hover:border-white/30"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={`w-4 h-4 rounded-full border-2 flex-shrink-0 mt-0.5 ${
                              selectedReason === reason.value
                                ? "border-white bg-white"
                                : "border-white/30"
                            }`}
                          >
                            {selectedReason === reason.value && (
                              <div className="w-full h-full flex items-center justify-center">
                                <div className="w-2 h-2 rounded-full bg-black" />
                              </div>
                            )}
                          </div>
                          <div>
                            <span className="block text-sm font-medium text-white">
                              {reason.label}
                            </span>
                            <span className="block text-xs text-white/50 mt-0.5">
                              {reason.description}
                            </span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    Additional Details <span className="text-white/40">(optional)</span>
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Tell us more about what happened..."
                    maxLength={500}
                    rows={3}
                    className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/30 text-sm resize-none focus:outline-none focus:border-white/30"
                  />
                  <p className="text-xs text-white/40 mt-1 text-right">
                    {description.length}/500
                  </p>
                </div>

                {/* Submit Button */}
                <button
                  onClick={handleSubmit}
                  disabled={!selectedReason || isSubmitting}
                  className="w-full py-3 px-4 rounded-xl bg-red-500 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-600 transition-colors flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Flag className="w-4 h-4" />
                      Submit Report
                    </>
                  )}
                </button>

                <button
                  onClick={onClose}
                  className="w-full py-2 text-sm text-white/50 hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
