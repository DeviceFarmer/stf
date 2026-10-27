interface Position {
  x: number
  y: number
  pressure: number
}

/** Both native minitouch and STFService understand d/m/u/c; only native supports r. */
export class TouchProtocol {
  private readonly active = new Set<number>()
  private readonly pending = new Map<number, Position | null>()

  constructor(
    private readonly write: (command: string) => void
  , private readonly maxContacts: () => number
  ) {}

  private valid(contact: number): boolean {
    return Number.isInteger(contact) && contact >= 0 &&
      contact < Math.min(32, this.maxContacts())
  }

  down(contact: number, position: Position) {
    if (this.valid(contact)) {
      this.pending.set(contact, position)
    }
  }

  move(contact: number, position: Position) {
    const pressed = this.pending.has(contact) ? this.pending.get(contact) : this.active.has(contact)
    if (this.valid(contact) && pressed) {
      this.pending.set(contact, position)
    }
  }

  up(contact: number) {
    if (this.valid(contact)) {
      this.pending.set(contact, null)
    }
  }

  commit() {
    const commands: string[] = []
    for (const [contact, position] of this.pending) {
      if (position) {
        const type = this.active.has(contact) ? 'm' : 'd'
        commands.push(`${type} ${contact} ${position.x} ${position.y} ${position.pressure}\n`)
      }
      else if (this.active.has(contact)) {
        commands.push(`u ${contact}\n`)
      }
    }
    if (commands.length) {
      this.write(commands.join('') + 'c\n')
      for (const [contact, position] of this.pending) {
        if (position) {
          this.active.add(contact)
        }
        else {
          this.active.delete(contact)
        }
      }
    }
    this.pending.clear()
  }

  reset() {
    // Drop commands which were never committed. Flushing a pending down before
    // its up can otherwise create an unintended tap in STFService's fallback.
    this.pending.clear()
    if (this.active.size) {
      const contacts = [...this.active].sort((left, right) => right - left)
      // STFService's single-update commit always uses slot zero. Include its
      // up in the same batch, even if a raw client started with another slot.
      if (!this.active.has(0)) {
        contacts.push(0)
      }
      this.write(contacts.map(contact => `u ${contact}\n`).join('') + 'c\n')
      this.active.clear()
    }
  }
}
