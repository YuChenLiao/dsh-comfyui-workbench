import type { Translate } from '../i18n.js'
import type { SurfaceSlot } from '../types.js'

/** 一个输入控件。按 type 决定形态，不猜。 */
export function Field(props: {
  slot: SurfaceSlot
  value: unknown
  t: Translate
  onChange: (value: unknown) => void
}): React.ReactElement {
  const { slot, value, t, onChange } = props
  const id = `cwf-${slot.name}`

  const label = (
    <label className="cwf-field-label" htmlFor={id}>
      {slot.label !== '' ? slot.label : slot.name}
      {slot.required ? <span className="cwf-req">*</span> : null}
      <span className="cwf-field-type">{slot.type}</span>
    </label>
  )

  let control: React.ReactElement
  if (slot.type === 'boolean') {
    control = (
      <input
        id={id}
        type="checkbox"
        checked={value === true}
        onChange={event => onChange(event.target.checked)}
      />
    )
  } else if (slot.type === 'number') {
    control = (
      <input
        id={id}
        type="number"
        className="cwf-input"
        value={value === undefined || value === null ? '' : String(value)}
        {...(slot.min === undefined ? {} : { min: slot.min })}
        {...(slot.max === undefined ? {} : { max: slot.max })}
        {...(slot.step === undefined ? {} : { step: slot.step })}
        onChange={event => {
          const raw = event.target.value
          onChange(raw === '' ? undefined : Number(raw))
        }}
      />
    )
  } else if (slot.type === 'enum') {
    const options = slot.options ?? []
    control = (
      <select
        id={id}
        className="cwf-input"
        value={value === undefined ? '' : String(value)}
        onChange={event => onChange(event.target.value)}
      >
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    )
  } else if (slot.type === 'image' || slot.type === 'mask') {
    control = (
      <input
        id={id}
        type="text"
        className="cwf-input"
        placeholder={t('fieldImagePlaceholder')}
        value={value === undefined ? '' : String(value)}
        onChange={event => onChange(event.target.value)}
      />
    )
  } else {
    // string：单行框够用就行；提示词给多行。
    const multiline = /prompt|negative|text/i.test(slot.name)
    control = multiline
      ? (
        <textarea
          id={id}
          className="cwf-input"
          rows={3}
          value={value === undefined ? '' : String(value)}
          onChange={event => onChange(event.target.value)}
        />
      )
      : (
        <input
          id={id}
          type="text"
          className="cwf-input"
          value={value === undefined ? '' : String(value)}
          onChange={event => onChange(event.target.value)}
        />
      )
  }

  return (
    <div className={`cwf-field cwf-field-${slot.type}`}>
      {label}
      {control}
      {slot.hint !== undefined && slot.hint !== '' ? <div className="cwf-hint">{slot.hint}</div> : null}
    </div>
  )
}
