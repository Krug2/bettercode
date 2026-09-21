const ESSENTIAL_CONTROLS_MIN_WIDTH = 400
const PERMISSION_CONTROL_MIN_WIDTH = 640

export interface ComposerControlVisibility {
  showEssentialControls: boolean
  showPermissionControl: boolean
}

export function getComposerControlVisibility(
  measuredWidth: number
): ComposerControlVisibility {
  const hasMeasurement = measuredWidth > 0

  return {
    showEssentialControls:
      !hasMeasurement || measuredWidth >= ESSENTIAL_CONTROLS_MIN_WIDTH,
    showPermissionControl:
      !hasMeasurement || measuredWidth >= PERMISSION_CONTROL_MIN_WIDTH,
  }
}
