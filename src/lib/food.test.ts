import { describe, expect, it } from 'vitest'
import { availableUnits, fmtAmount, kcalFor, labelWarnings, parseNumber, type FoodKcal } from './food'

const dry: FoodKcal = { kcal_per_kg: 3850, kcal_per_cup: 412, kcal_per_unit: null, unit_name: null }
const wet: FoodKcal = { kcal_per_kg: null, kcal_per_cup: null, kcal_per_unit: 85, unit_name: 'can' }

describe('label calories → kcal eaten', () => {
  it('a dry food with both figures can be logged in cups or grams', () => expect(availableUnits(dry)).toEqual(['cup', 'g']))
  it('¼ cup at 412 kcal/cup = 103', () => expect(kcalFor(0.25, 'cup', dry)).toBe(103))
  it('30 g at 3,850 kcal/kg = 115.5', () => expect(kcalFor(30, 'g', dry)).toBe(115.5))
  it('half a can at 85 kcal/can = 42.5', () => expect(kcalFor(0.5, 'can', wet)).toBe(42.5))
  it('no figure for that unit → NaN, never a made-up number', () => expect(kcalFor(1, 'cup', wet)).toBeNaN())
  it('parses label numbers', () => {
    expect(parseNumber('3,850')).toBe(3850)
    expect(parseNumber('')).toBeNaN(); expect(parseNumber('0')).toBeNaN(); expect(parseNumber('abc')).toBeNaN()
  })
  it('formats amounts', () => {
    expect(fmtAmount(0.25, 'cup')).toBe('¼ cup'); expect(fmtAmount(1.5, 'can')).toBe('1½ cans'); expect(fmtAmount(30, 'g')).toBe('30 g')
  })
})

describe('label sanity checks', () => {
  it('flags a kcal/kg number typed into kcal/cup (the C/D case)', () => {
    expect(labelWarnings({ kcal_per_kg: null, kcal_per_cup: 3286, kcal_per_unit: null, unit_name: null })[0]).toMatch(/kcal per kg/)
  })
  it('accepts normal dry and wet labels', () => {
    expect(labelWarnings(dry)).toEqual([])
    expect(labelWarnings(wet)).toEqual([])
    expect(labelWarnings({ kcal_per_kg: 1050, kcal_per_cup: null, kcal_per_unit: 82, unit_name: 'can' })).toEqual([])
  })
  it('flags kg and cup figures that cannot be the same food', () => {
    expect(labelWarnings({ kcal_per_kg: 3850, kcal_per_cup: 1000, kcal_per_unit: null, unit_name: null }).length).toBeGreaterThan(0)
  })
})
