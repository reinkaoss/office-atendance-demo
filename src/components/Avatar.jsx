import { initials, colorFor } from '../lib/supabase'

export default function Avatar({ profile, size = 28, confirmed = false, absent = false, ...rest }) {
  const style = {
    width: size,
    height: size,
    fontSize: size * 0.38,
    background: profile?.avatar_url ? undefined : colorFor(profile?.id || ''),
    backgroundImage: profile?.avatar_url ? `url(${profile.avatar_url})` : undefined,
  }
  return (
    <div className={`avatar ${confirmed ? 'confirmed' : ''} ${absent ? 'absent' : ''}`} style={style} title={profile?.full_name} {...rest}>
      {!profile?.avatar_url && initials(profile?.full_name)}
    </div>
  )
}
