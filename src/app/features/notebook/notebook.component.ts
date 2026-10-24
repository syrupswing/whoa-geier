import { Component, OnInit, TemplateRef, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { TextFieldModule } from '@angular/cdk/text-field';
import { Note, NoteService } from '../../services/note.service';
import { NOTE_KINDS, NoteField, NoteKind, noteKindDef } from '../../services/note-kinds';
import { HouseholdService } from '../../services/household.service';
import { AddButtonComponent } from '../../shared/add-button/add-button.component';
import { GlobalNavMenuComponent } from '../../shared/global-nav-menu/global-nav-menu.component';
import { highlightWhenPresent } from '../../utils/highlight';

interface NoteForm {
  kind: NoteKind;
  title: string;
  body: string;
  category: string;
  tags: string;
  memberId: string;
  data: Record<string, string>;
}

const emptyForm = (kind: NoteKind = 'provider'): NoteForm =>
  ({ kind, title: '', body: '', category: '', tags: '', memberId: '', data: {} });

/** The family notebook: service providers, places, warranties, how-tos, free-form notes and facts. */
@Component({
  selector: 'app-notebook',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatIconModule, MatButtonModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatDialogModule, MatSnackBarModule, TextFieldModule,
    GlobalNavMenuComponent, AddButtonComponent
  ],
  templateUrl: './notebook.component.html',
  styleUrl: './notebook.component.scss'
})
export class NotebookComponent implements OnInit {
  readonly noteService = inject(NoteService);
  readonly household = inject(HouseholdService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly route = inject(ActivatedRoute);

  @ViewChild('noteDialog') private noteDialog?: TemplateRef<unknown>;
  private dialogRef?: MatDialogRef<unknown>;

  readonly kinds = NOTE_KINDS;
  readonly kindDef = noteKindDef;

  search = signal('');
  kindFilter = signal<NoteKind | null>(null);
  categoryFilter = signal<string | null>(null);

  editingId = signal<string | null>(null);
  form: NoteForm = emptyForm();
  isSaving = signal(false);

  /** Kinds that have at least one entry, so empty filter chips don't clutter the page. */
  kindsInUse = computed(() => {
    const used = new Set(this.noteService.notes().map(n => n.kind));
    return NOTE_KINDS.filter(k => used.has(k.kind));
  });

  /** Categories used within the chosen kind (or all kinds). */
  categoryChips = computed(() => {
    const kind = this.kindFilter();
    const set = new Set<string>();
    this.noteService.notes().filter(n => !kind || n.kind === kind).forEach(n => n.category && set.add(n.category));
    return [...set].sort();
  });

  visible = computed(() => {
    const kind = this.kindFilter();
    const category = this.categoryFilter();
    const terms = this.search().toLowerCase().split(/\s+/).filter(Boolean);
    return this.noteService.notes().filter(n => {
      if (kind && n.kind !== kind) return false;
      if (category && n.category !== category) return false;
      if (!terms.length) return true;
      const haystack = [n.title, n.body, n.category, n.kind, ...(n.tags ?? []), ...Object.values(n.data ?? {})]
        .join(' ').toLowerCase();
      return terms.every(t => haystack.includes(t));
    });
  });

  ngOnInit(): void {
    const highlight = this.route.snapshot.queryParamMap.get('highlight');
    if (highlight) highlightWhenPresent(highlight);
  }

  setKindFilter(kind: NoteKind | null): void {
    this.kindFilter.set(kind);
    this.categoryFilter.set(null);
  }

  fieldsFor(kind: NoteKind): NoteField[] {
    return noteKindDef(kind).fields;
  }

  /** Detail fields that have a value, for the read-only card. */
  details(note: Note): { field: NoteField; value: string }[] {
    return noteKindDef(note.kind).fields
      .filter(f => note.data?.[f.key])
      .map(f => ({ field: f, value: note.data![f.key] }));
  }

  /** The link a detail turns into (call, email, open, map), or null for plain text. */
  linkFor(field: NoteField, value: string): string | null {
    if (field.type === 'tel') return `tel:${value.replace(/[^\d+]/g, '')}`;
    if (field.type === 'email') return `mailto:${value}`;
    if (field.type === 'url') return /^https?:\/\//i.test(value) ? value : `https://${value}`;
    if (field.key === 'address') return `https://maps.google.com/?q=${encodeURIComponent(value)}`;
    return null;
  }

  displayLabel(field: NoteField): string {
    return field.label.replace(/ \(.*\)$/, '');
  }

  memberName(memberId: string | undefined): string | null {
    return memberId ? this.household.getMemberById(memberId)?.name ?? null : null;
  }

  openAdd(): void {
    this.editingId.set(null);
    this.form = emptyForm(this.kindFilter() ?? 'provider');
    this.openDialog();
  }

  openEdit(note: Note): void {
    this.editingId.set(note.id);
    this.form = {
      kind: note.kind,
      title: note.title,
      body: note.body ?? '',
      category: note.category ?? '',
      tags: (note.tags ?? []).join(', '),
      memberId: note.memberId ?? '',
      data: { ...(note.data ?? {}) }
    };
    this.openDialog();
  }

  private openDialog(): void {
    if (!this.noteDialog) return;
    this.dialogRef = this.dialog.open(this.noteDialog, { width: '560px', maxWidth: '95vw', autoFocus: 'first-tabbable' });
  }

  canSave(): boolean {
    return !!(this.form.title.trim() || this.form.body.trim());
  }

  async save(): Promise<void> {
    if (!this.canSave() || this.isSaving()) return;
    this.isSaving.set(true);
    const f = this.form;
    const tags = f.tags.split(',').map(t => t.trim()).filter(Boolean);
    const common = {
      kind: f.kind,
      title: f.title.trim() || f.body.trim().slice(0, 60),
      body: f.body.trim() || undefined,
      category: f.category || undefined,
      tags,
      memberId: f.memberId || undefined,
      data: Object.fromEntries(this.fieldsFor(f.kind).map(fl => [fl.key, f.data[fl.key] ?? '']))
    };
    try {
      const id = this.editingId();
      const ok = id
        ? await this.noteService.update(id, common)
        : !!(await this.noteService.add({ ...common, source: 'manual' }));
      if (ok) {
        this.dialogRef?.close();
      } else {
        this.snackBar.open('Failed to save — try again', 'Close', { duration: 3000 });
      }
    } finally {
      this.isSaving.set(false);
    }
  }

  async remove(note: Note): Promise<void> {
    if (!confirm(`Delete "${note.title}"?`)) return;
    if (!(await this.noteService.remove(note.id))) {
      this.snackBar.open('Failed to delete', 'Close', { duration: 3000 });
    }
  }
}
