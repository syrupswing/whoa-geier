import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { SettingRowComponent } from './setting-row.component';

@Component({
  standalone: true,
  imports: [SettingRowComponent, FormsModule],
  template: `
    <dl>
      <app-setting-row #row label="First name" [value]="value" (editStart)="draft = value" (save)="saved = draft; row.close()">
        <input editor class="draft" name="draft" [(ngModel)]="draft">
      </app-setting-row>
    </dl>`
})
class HostComponent {
  value = 'Nathan';
  draft = '';
  saved: string | null = null;
}

describe('SettingRowComponent', () => {
  function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    return { fixture, el, host: fixture.componentInstance };
  }

  it('shows the value and an edit button, with no editor yet', () => {
    const { el } = setup();
    expect(el.querySelector('.setting-value')?.textContent).toContain('Nathan');
    expect(el.querySelector('.edit-btn')).not.toBeNull();
    expect(el.querySelector('input.draft')).toBeNull();
  });

  it('opens the editor with the current value when edit is clicked', async () => {
    const { fixture, el } = setup();
    (el.querySelector('.edit-btn') as HTMLElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const input = el.querySelector('input.draft') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('Nathan');
  });

  it('saves what was typed and closes, without submitting the page', async () => {
    const { fixture, el, host } = setup();
    (el.querySelector('.edit-btn') as HTMLElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    const input = el.querySelector('input.draft') as HTMLInputElement;
    input.value = 'Nate';
    input.dispatchEvent(new Event('input'));

    // A native submit that nobody prevents would reload the page, so check that explicitly.
    const form = el.querySelector('form') as HTMLFormElement;
    const submit = new Event('submit', { cancelable: true });
    form.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBeTrue();

    fixture.detectChanges();
    expect(host.saved).toBe('Nate');
    expect(el.querySelector('input.draft')).toBeNull();
  });

  it('cancel leaves the value alone', async () => {
    const { fixture, el, host } = setup();
    (el.querySelector('.edit-btn') as HTMLElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    const cancel = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Cancel') as HTMLElement;
    cancel.click();
    fixture.detectChanges();
    expect(host.saved).toBeNull();
    expect(el.querySelector('input.draft')).toBeNull();
  });
});
