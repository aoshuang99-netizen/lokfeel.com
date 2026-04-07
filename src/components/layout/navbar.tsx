"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { Menu, X, Heart } from "lucide-react";

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <>
      {/* Scroll Progress Bar */}
      <div
        className="scroll-progress"
        style={{ width: `${typeof window !== "undefined" ? (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100 : 0}%` }}
      />

      {/* Navbar */}
      <nav
        className={`fixed top-0 left-0 right-0 z-sticky transition-all duration-300 ${
          isScrolled
            ? "glass-strong py-3"
            : "bg-transparent py-5"
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2 group">
              <div className="relative">
                <Heart className="w-8 h-8 text-primary group-hover:fill-primary transition-all duration-300" />
                <div className="absolute inset-0 blur-md bg-primary/30 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <span className="text-2xl font-bold text-gradient">Nexus</span>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-8">
              <Link
                href="/about"
                className="text-white/60 hover:text-white transition-colors font-medium"
              >
                About
              </Link>
              <Link
                href="/privacy"
                className="text-white/60 hover:text-white transition-colors font-medium"
              >
                Privacy
              </Link>
              <Link
                href="/terms"
                className="text-white/60 hover:text-white transition-colors font-medium"
              >
                Terms
              </Link>
              <div className="flex items-center gap-3 ml-4">
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
                  Join Nexus
                </Link>
              </div>
            </div>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-2 text-white/80 hover:text-white transition-colors"
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

      {/* Mobile Menu */}
      <div
        className={`fixed inset-0 z-dropdown md:hidden transition-all duration-300 ${
          isMobileMenuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={() => setIsMobileMenuOpen(false)}
        />
        <div className="absolute top-0 right-0 w-80 h-full bg-background-secondary border-l border-white/10 p-6 pt-20">
          <div className="flex flex-col gap-4">
            <Link
              href="/about"
              className="text-lg text-white/80 hover:text-white transition-colors py-2"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              About
            </Link>
            <Link
              href="/privacy"
              className="text-lg text-white/80 hover:text-white transition-colors py-2"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="text-lg text-white/80 hover:text-white transition-colors py-2"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Terms
            </Link>
            <div className="h-px bg-white/10 my-2" />
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
              Join Nexus
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
