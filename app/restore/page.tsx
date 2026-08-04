import { RestoreForm } from "@/components/collection/restore-form";

export const metadata = { title: "Restore your space" };

export default function RestorePage() {
  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <div className="text-5xl">🔑</div>
      <h1 className="mt-4 text-3xl font-semibold text-slate-900">Restore your space</h1>
      <p className="mt-3 text-slate-600">
        Paste the recovery key from your other device to bring your collected words here. You can
        find it on your <strong>Your Space</strong> page.
      </p>
      <div className="mt-6">
        <RestoreForm />
      </div>
    </div>
  );
}
