// Avatar — the account face shown at the top of the page (owner order
// 2026-11-03, Supabase-style): a purple-gradient disc with a clean person
// bust. If the account has a photo URL (user_metadata.avatar_url), the
// photo is shown instead. Clicking it (the wrapping button in App) opens
// the personal profile page.

export default function Avatar({ size = 36, photoUrl }: { size?: number; photoUrl?: string }) {
  if (photoUrl) {
    return <img className="avatar-graphic" src={photoUrl} width={size} height={size} alt="" style={{ width: size, height: size }} />
  }
  return (
    <svg className="avatar-graphic" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" style={{ width: size, height: size }}>
      <defs>
        <linearGradient id="vyroAvatarGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8B7CFF" />
          <stop offset="1" stopColor="#5A3DF0" />
        </linearGradient>
        <clipPath id="vyroAvatarClip"><circle cx="24" cy="24" r="24" /></clipPath>
      </defs>
      <g clipPath="url(#vyroAvatarClip)">
        <circle cx="24" cy="24" r="24" fill="url(#vyroAvatarGrad)" />
        <circle cx="24" cy="19.5" r="7" fill="#ffffff" />
        <ellipse cx="24" cy="40.5" rx="12.5" ry="9" fill="#ffffff" />
      </g>
    </svg>
  )
}
