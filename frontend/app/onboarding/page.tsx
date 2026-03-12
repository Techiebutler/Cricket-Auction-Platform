"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { useAuthStore } from "@/store/auth";

function RatingSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between mb-1">
        <label className="label">{label}</label>
        <span className="text-amber-400 font-bold">{value}/10</span>
      </div>
      <input
        type="range"
        min={1}
        max={10}
        step={0.5}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-amber-500"
      />
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const { user, setAuth, token } = useAuthStore();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    phone: "",
    batting_rating: 5,
    bowling_rating: 5,
    fielding_rating: 5,
  });
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhoto(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    try {
      // Upload photo first if selected
      if (photo) {
        const fd = new FormData();
        fd.append("file", photo);
        const photoRes = await api.post("/auth/upload-photo", fd);
        if (token && user) {
          setAuth({ ...user, profile_photo: photoRes.data.profile_photo }, token);
        }
      }

      // Save onboarding data
      const { data } = await api.patch("/auth/onboard", {
        phone: form.phone || null,
        batting_rating: form.batting_rating,
        bowling_rating: form.bowling_rating,
        fielding_rating: form.fielding_rating,
      });

      if (token) setAuth(data, token);
      router.push("/dashboard");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Failed to save profile");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-lg">
        <h1 className="text-2xl font-bold mb-2">Complete Your Profile</h1>
        <p className="text-gray-500 text-sm mb-6">
          Tell us about your cricket skills to get started.
        </p>

        {error && (
          <div className="bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg p-3 mb-4 text-sm">
            {error}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="label">Profile Photo</label>
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-full bg-gray-800 border-2 border-dashed border-gray-600 flex items-center justify-center overflow-hidden">
                  {photoPreview ? (
                    <img src={photoPreview} alt="preview" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-gray-500 text-2xl">📷</span>
                  )}
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  className="text-sm text-gray-400"
                />
              </div>
            </div>
            <div>
              <label className="label">Phone Number (optional)</label>
              <input
                type="tel"
                className="input"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+91 98765 43210"
              />
            </div>
            <button className="btn-primary w-full" onClick={() => setStep(2)}>
              Next: Cricket Ratings
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <RatingSlider
              label="Batting Rating"
              value={form.batting_rating}
              onChange={(v) => setForm({ ...form, batting_rating: v })}
            />
            <RatingSlider
              label="Bowling Rating"
              value={form.bowling_rating}
              onChange={(v) => setForm({ ...form, bowling_rating: v })}
            />
            <RatingSlider
              label="Fielding Rating"
              value={form.fielding_rating}
              onChange={(v) => setForm({ ...form, fielding_rating: v })}
            />
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setStep(1)}>
                Back
              </button>
              <button className="btn-primary flex-1" onClick={handleSubmit} disabled={loading}>
                {loading ? "Saving..." : "Complete Setup"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
