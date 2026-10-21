import { describeProfile, type VoiceProfile } from "@/lib/domain/voice";

export function ProfileView({ profile }: { profile: VoiceProfile }) {
  const rows = describeProfile(profile);
  if (!rows.length) return <p className="text-sm text-muted">This version is empty.</p>;
  return (
    <dl className="space-y-4 text-sm">
      {rows.map(({ label, values }) => (
        <div key={label}>
          <dt className="text-muted">{label}</dt>
          <dd>
            {values.length === 1 ? (
              values[0]
            ) : (
              <ul className="list-disc pl-5">
                {values.map((value) => (
                  <li key={value}>{value}</li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
