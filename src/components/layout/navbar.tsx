"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";
import { LokFeeLogo } from "@/components/LokFeeLogo";

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 30);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { label: "About", href: "/about" },
    { label: "Features", href: "/#features" },
    { label: "How It Works", href: "/#how" },
  ];

  return (
    <>
      {/* Navbar */}
      <nav
        className={`fixed top-0 left-0 right-0 z-sticky transition-all duration-500 ${
          isScrolled
            ? "glass-strong py-3 shadow-lg shadow-black/10"
            : "bg-transparent py-4"
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <Link href="/" className="group">
              <LokFeeLogo size="md" showText={true} animated={true} />
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="px-3.5 py-2 text-sm text-foreground-muted hover:text-foreground transition-colors rounded-lg hover:bg-background-tertiary"
                >
                  {link.label}
                </Link>
              ))}
              <div className="flex items-center gap-3 ml-4 pl-4 border-l border-card-border">
                <Link
                  href="/login"
                  className="btn-ghost text-sm"
                >
                  Log in
                </Link>
                <Link
                  href="/register"
                  className="btn-primary text-sm"
                >
                  Get Started
                </Link>
              </div>
            </div>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-2 text-foreground hover:text-foreground transition-colors"
              aria-label="Toggle menu"
            >
              {isMobileMenuOpen ? (
                <X className="w-6 h-6" />
              ) : (
                <Menu className="w-6 h-6" />
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Menu — Feeld-style slide-over */}
      <div
        className={`fixed inset-0 z-dropdown md:hidden transition-all duration-300 ${
          isMobileMenuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={() => setIsMobileMenuOpen(false)}
        />
        <div className="absolute top-0 right-0 w-80 h-full bg-background-secondary border-l border-card-border p-6 pt-20 animate-slide-in-right">
          <div className="flex flex-col gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-lg text-foreground hover:text-foreground transition-colors py-2.5 rounded-lg hover:bg-background-tertiary"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <div className="h-px bg-background-tertiary my-3" />
            <Link
              href="/privacy"
              className="text-sm text-foreground-muted hover:text-foreground transition-colors py-2"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Privacy Policy
            </Link>
            <Link
              href="/terms"
              className="text-sm text-foreground-muted hover:text-foreground transition-colors py-2"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Terms of Service
            </Link>
            <Link
              href="/cookies"
              className="text-sm text-foreground-muted hover:text-foreground transition-colors py-2"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Cookie Policy
            </Link>
            <a
              href="mailto:hello@lokfeel.com"
              className="text-sm text-foreground-muted hover:text-foreground transition-colors py-2"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Contact Us
            </a>
            <div className="h-px bg-background-tertiary my-3" />
            <Link
              href="/login"
              className="btn-secondary w-full"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Log in
            </Link>
            <Link
              href="/register"
              className="btn-primary w-full"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Get Started
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
