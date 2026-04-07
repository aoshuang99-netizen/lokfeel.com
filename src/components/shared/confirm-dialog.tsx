"use client";

import { useEffect, useRef, ReactNode } from "react";
import { X, AlertTriangle, CheckCircle, Info } from "lucide-react";

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "info" | "default";
  isLoading?: boolean;
  children?: ReactNode;
}

const variantConfig = {
  danger: {
    icon: AlertTriangle,
    iconColor: "text-error",
    iconBg: "bg-error/20",
    buttonClass: "bg-gradient-to-r from-error to-red-600 hover:from-error hover:to-red-700",
  },
  warning: {
    icon: AlertTriangle,
    iconColor: "text-warning",
    iconBg: "bg-warning/20",
    buttonClass: "bg-gradient-to-r from-warning to-amber-600 hover:from-warning hover:to-amber-700",
  },
  info: {
    icon: Info,
    iconColor: "text-info",
    iconBg: "bg-info/20",
    buttonClass: "bg-gradient-to-r from-info to-blue-600 hover:from-info hover:to-blue-700",
  },
  default: {
    icon: CheckCircle,
    iconColor: "text-primary",
    iconBg: "bg-primary/20",
    buttonClass: "bg-gradient-to-r from-primary to-secondary hover:opacity-90",
  },
};

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "default",
  isLoading = false,
  children,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const config = variantConfig[variant];
  const Icon = config.icon;

  return (
    <div className="fixed inset-0 z-modal-backdrop">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="fixed inset-0 flex items-center justify-center p-4 z-modal">
        <div
          ref={dialogRef}
          className="glass-card max-w-md w-full p-6 animate-slide-up"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialog-title"
        >
          {/* Icon */}
          <div className={`w-14 h-14 mx-auto rounded-full ${config.iconBg} flex items-center justify-center mb-5`}>
            <Icon className={`w-7 h-7 ${config.iconColor}`} />
          </div>

          {/* Title */}
          <h2 id="dialog-title" className="text-xl font-semibold text-white text-center mb-2">
            {title}
          </h2>

          {/* Description */}
          {description && (
            <p className="text-white/60 text-center mb-6">
              {description}
            </p>
          )}

          {/* Custom Content */}
          {children && <div className="mb-6">{children}</div>}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={isLoading}
              className="flex-1 btn-secondary"
            >
              {cancelText}
            </button>
            <button
              onClick={onConfirm}
              disabled={isLoading}
              className={`flex-1 btn-primary text-white ${config.buttonClass}`}
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Processing...
                </span>
              ) : (
                confirmText
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Preset dialog configurations
interface DeleteDialogProps extends Omit<ConfirmDialogProps, "variant" | "title" | "confirmText"> {
  itemName?: string;
}

export function DeleteDialog({
  itemName = "this item",
  onConfirm,
  ...props
}: DeleteDialogProps) {
  return (
    <ConfirmDialog
      {...props}
      variant="danger"
      title="Delete Confirmation"
      description={`Are you sure you want to delete ${itemName}? This action cannot be undone.`}
      confirmText="Delete"
      onConfirm={() => {
        onConfirm();
        props.onClose();
      }}
    />
  );
}

interface BanDialogProps extends Omit<ConfirmDialogProps, "variant" | "title" | "confirmText"> {
  userName?: string;
}

export function BanDialog({
  userName = "this user",
  onConfirm,
  ...props
}: BanDialogProps) {
  return (
    <ConfirmDialog
      {...props}
      variant="warning"
      title="Ban User"
      description={`Are you sure you want to ban ${userName}? They will lose access to their account.`}
      confirmText="Ban User"
      onConfirm={() => {
        onConfirm();
        props.onClose();
      }}
    />
  );
}
