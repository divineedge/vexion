import React, { useEffect, useState } from 'react';
import { BASE_URL } from '@/lib/apiBaseUrl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { visibleTemplateFields, type TemplateField } from '@/lib/formVisibility';

interface PublicForm {
  name: string;
  purpose: 'quote' | 'hiring';
  serviceId: number | null;
  serviceName: string | null;
  companyName: string;
  fields: TemplateField[];
}

export default function PublicFormTemplatePage({ token }: { token: string }) {
  const [form, setForm] = useState<PublicForm | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    fetch(`${BASE_URL}/api/public/form-templates/${token}`).then(async response => {
      if (!response.ok) throw new Error('This form is not available.');
      setForm(await response.json());
    }).catch(reason => setError(reason.message));
  }, [token]);
  if (error) return <main className="max-w-lg mx-auto p-8 text-sm">{error}</main>;
  if (!form) return <main className="max-w-lg mx-auto p-8 text-sm">Loading form…</main>;
  if (done) return <main className="max-w-lg mx-auto p-8"><h1 className="text-xl font-semibold">Thank you</h1><p className="text-sm text-muted-foreground mt-2">{form.purpose === 'hiring' ? 'Your application is in the hiring queue.' : 'Your request is in the office as a lead and a draft estimate.'}</p></main>;
  const visible = visibleTemplateFields(form.fields, { ...answers, service_id: form.serviceId ?? answers.service_id }, form.serviceId);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const payload = { ...answers };
    if (file) payload.resume = file.name;
    const body = new FormData();
    body.set('answers', JSON.stringify(payload));
    if (file) body.set('resume', file);
    const response = await fetch(`${BASE_URL}/api/public/form-templates/${token}`, { method: 'POST', body });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? 'The form could not be submitted.');
      return;
    }
    setDone(true);
  };
  return (
    <main className="max-w-lg mx-auto p-6 space-y-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{form.companyName}</p>
      <h1 className="text-2xl font-semibold">{form.name}</h1>
      {form.serviceName && <p className="text-sm text-muted-foreground">This form is for {form.serviceName}.</p>}
      <form className="space-y-3" onSubmit={submit}>
        {visible.map(field => (
          <label key={field.id} className="block space-y-1 text-sm">
            <span className="font-medium">{field.label}{field.required ? ' *' : ''}</span>
            {field.type === 'textarea' ? <Textarea value={String(answers[field.id] ?? '')} onChange={e => setAnswers(a => ({ ...a, [field.id]: e.target.value }))} />
              : field.type === 'select' ? (
                <select className="w-full rounded-md border bg-background px-3 py-2" value={String(answers[field.id] ?? '')} onChange={e => setAnswers(a => ({ ...a, [field.id]: e.target.value }))}>
                  <option value="">Choose</option>
                  {field.options.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
              ) : field.type === 'checkbox' ? (
                <input type="checkbox" checked={answers[field.id] === true} onChange={e => setAnswers(a => ({ ...a, [field.id]: e.target.checked }))} />
              ) : field.type === 'file' ? <Input type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} />
                : <Input type={field.type === 'phone' ? 'tel' : field.type} value={String(answers[field.id] ?? '')} onChange={e => setAnswers(a => ({ ...a, [field.id]: e.target.value }))} />}
          </label>
        ))}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit">Submit</Button>
      </form>
    </main>
  );
}
