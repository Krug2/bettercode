const maximumRadius = 108
const known = (amount: number | null): amount is number => amount !== null && Number.isFinite(amount) && amount >= 0

export function amountScale(amounts: readonly (number | null)[]) {
  const values = amounts.filter(known).sort((a, b) => a - b)
  const minimum = values[0], maximum = values[values.length - 1]
  const median = values[Math.floor((values.length - 1) / 2)] / 2 + values[Math.floor(values.length / 2)] / 2
  return (amount: number | null) => {
    let intensity: number | null = null
    if (known(amount) && values.length) {
      if (minimum === maximum) intensity = 0.5
      else if (amount <= minimum) intensity = 0
      else if (amount >= maximum) intensity = 1
      else intensity = amount <= median
        ? 0.5 * (amount - minimum) / (median - minimum)
        : 0.5 + 0.5 * (amount - median) / (maximum - median)
    }
    return { intensity, radius: maximumRadius * Math.sqrt(0.1 + 0.9 * (intensity ?? 0)) }
  }
}
