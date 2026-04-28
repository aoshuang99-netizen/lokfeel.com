"use client";

import { useState, useEffect, useCallback } from "react";
import { MapPin, Navigation, ChevronDown, Loader2, AlertCircle } from "lucide-react";
import { US_STATES, getStateByCode, formatLocation } from "@/lib/us-locations";

interface LocationPickerProps {
  value: string;
  onChange: (value: string) => void;
}

export function LocationPicker({ value, onChange }: LocationPickerProps) {
  const [mode, setMode] = useState<"prompt" | "detecting" | "manual" | "detected">("prompt");
  const [selectedState, setSelectedState] = useState("");
  const [selectedCity, setSelectedCity] = useState("");
  const [customAddress, setCustomAddress] = useState("");
  const [geoError, setGeoError] = useState("");
  const [detectedLocation, setDetectedLocation] = useState("");

  // Parse existing value on mount
  useEffect(() => {
    if (value && mode === "prompt") {
      // If value already set, skip to manual with it pre-filled
      const parts = value.split(", ");
      if (parts.length >= 2) {
        const cityPart = parts[0];
        const statePart = parts[1];
        // Try to find matching state
        const matchState = US_STATES.find(
          s => s.code === statePart || s.name.toLowerCase() === statePart.toLowerCase()
        );
        if (matchState) {
          setSelectedState(matchState.code);
          // Try to find matching city
          const matchCity = matchState.cities.find(
            c => c.toLowerCase() === cityPart.toLowerCase()
          );
          if (matchCity) {
            setSelectedCity(matchCity);
          } else {
            setCustomAddress(cityPart);
          }
        }
      }
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-detect location via IP
  const detectLocation = useCallback(async () => {
    setMode("detecting");
    setGeoError("");

    try {
      const res = await fetch("/api/geo/ip");
      const data = await res.json();

      if (data.location && data.isUS) {
        const loc = data.location;
        const locationStr = formatLocation(loc.city, loc.regionCode || loc.region);
        setDetectedLocation(locationStr);
        setSelectedState(loc.regionCode || "");
        setSelectedCity(loc.city || "");
        setMode("detected");
        onChange(locationStr);
      } else if (data.location && !data.isUS) {
        setGeoError("Your IP location is outside the US. Please select manually.");
        setMode("manual");
      } else {
        setGeoError("Could not detect your location. Please select manually.");
        setMode("manual");
      }
    } catch {
      setGeoError("Location detection failed. Please select manually.");
      setMode("manual");
    }
  }, [onChange]);

  // Try browser geolocation API as backup
  const tryBrowserGeo = useCallback(() => {
    if (!navigator.geolocation) {
      detectLocation();
      return;
    }

    setMode("detecting");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        // Got browser position, but still need reverse geocoding
        // Fall back to IP-based detection which includes city/state
        detectLocation();
      },
      () => {
        // Browser denied or error, use IP detection
        detectLocation();
      },
      { timeout: 5000, enableHighAccuracy: false }
    );
  }, [detectLocation]);

  const handleStateChange = (stateCode: string) => {
    setSelectedState(stateCode);
    setSelectedCity("");
    setCustomAddress("");
    if (!stateCode) {
      onChange("");
    }
  };

  const handleCityChange = (city: string) => {
    setSelectedCity(city);
    if (city && selectedState) {
      onChange(formatLocation(city, selectedState));
    }
  };

  const handleCustomAddressChange = (address: string) => {
    setCustomAddress(address);
    if (address && selectedState) {
      onChange(formatLocation(address, selectedState));
    }
  };

  const handleConfirmDetected = () => {
    onChange(detectedLocation);
  };

  const handleUseDetectedButEdit = () => {
    setMode("manual");
  };

  const cities = selectedState ? getStateByCode(selectedState)?.cities || [] : [];

  // ─── PROMPT: Ask user if they want to auto-detect ───
  if (mode === "prompt") {
    return (
      <div className="space-y-3">
        <div className="p-4 rounded-xl border border-card-border bg-background-secondary">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Navigation className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">Auto-detect your location?</p>
              <p className="text-xs text-foreground-muted mt-1">
                We&apos;ll use your IP address to estimate your city and state. No precise GPS data is collected.
              </p>
            </div>
          </div>

          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={tryBrowserGeo}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary-hover transition-colors"
            >
              <Navigation className="w-4 h-4" />
              Allow Location
            </button>
            <button
              type="button"
              onClick={() => setMode("manual")}
              className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium border border-card-border text-foreground-muted hover:text-foreground hover:border-foreground-muted transition-colors"
            >
              Select Manually
            </button>
          </div>
        </div>

        {value && (
          <p className="text-xs text-foreground-muted">
            Current: <span className="text-foreground">{value}</span>
          </p>
        )}
      </div>
    );
  }

  // ─── DETECTING: Loading state ───
  if (mode === "detecting") {
    return (
      <div className="p-4 rounded-xl border border-card-border bg-background-secondary flex items-center gap-3">
        <Loader2 className="w-5 h-5 text-primary animate-spin" />
        <div>
          <p className="text-sm font-medium text-foreground">Detecting your location...</p>
          <p className="text-xs text-foreground-muted">Using your IP address</p>
        </div>
      </div>
    );
  }

  // ─── DETECTED: Show detected result with confirm/edit options ───
  if (mode === "detected") {
    return (
      <div className="space-y-3">
        <div className="p-4 rounded-xl border border-primary/30 bg-primary/5">
          <div className="flex items-center gap-2 mb-2">
            <MapPin className="w-4 h-4 text-primary" />
            <p className="text-sm font-semibold text-foreground">Location detected</p>
          </div>
          <p className="text-base font-medium text-primary">{detectedLocation}</p>
          <p className="text-xs text-foreground-muted mt-1">
            Based on your IP address. You can edit if incorrect.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleConfirmDetected}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary-hover transition-colors"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={handleUseDetectedButEdit}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium border border-card-border text-foreground-muted hover:text-foreground transition-colors"
          >
            Edit
          </button>
        </div>
      </div>
    );
  }

  // ─── MANUAL: State → City cascade selector ───
  return (
    <div className="space-y-3">
      {geoError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-warning/10 border border-warning/20">
          <AlertCircle className="w-4 h-4 text-warning flex-shrink-0" />
          <p className="text-xs text-foreground-muted">{geoError}</p>
        </div>
      )}

      {/* State selector */}
      <div>
        <label className="block text-xs font-medium text-foreground-muted mb-1.5">State</label>
        <div className="relative">
          <select
            value={selectedState}
            onChange={(e) => handleStateChange(e.target.value)}
            className="input-feeld appearance-none pr-8"
          >
            <option value="">Select a state...</option>
            {US_STATES.map((state) => (
              <option key={state.code} value={state.code}>
                {state.name}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted pointer-events-none" />
        </div>
      </div>

      {/* City selector (shows after state is selected) */}
      {selectedState && (
        <div>
          <label className="block text-xs font-medium text-foreground-muted mb-1.5">City</label>
          <div className="relative">
            <select
              value={selectedCity}
              onChange={(e) => handleCityChange(e.target.value)}
              className="input-feeld appearance-none pr-8"
            >
              <option value="">Select a city...</option>
              {cities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
              <option value="__custom__">Other (type below)...</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted pointer-events-none" />
          </div>
        </div>
      )}

      {/* Custom city input (when "Other" is selected) */}
      {selectedCity === "__custom__" && selectedState && (
        <div>
          <label className="block text-xs font-medium text-foreground-muted mb-1.5">
            Enter your city/county
          </label>
          <input
            type="text"
            value={customAddress}
            onChange={(e) => handleCustomAddressChange(e.target.value)}
            className="input-feeld"
            placeholder="e.g. Santa Monica"
          />
        </div>
      )}

      {/* Current value display */}
      {value && (
        <p className="text-xs text-foreground-muted">
          <MapPin className="w-3 h-3 inline mr-1" />
          Location: <span className="text-foreground font-medium">{value}</span>
        </p>
      )}

      {/* Try auto-detect link */}
      <button
        type="button"
        onClick={tryBrowserGeo}
        className="text-xs text-primary hover:underline"
      >
        Try auto-detect instead
      </button>
    </div>
  );
}
