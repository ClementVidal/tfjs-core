/**
 * @license
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import {Tensor} from '../tensor';
import * as util from '../util';

export function assertParamsValid(
    input: Tensor, begin: number[], size: number[]): void {
  util.assert(
      input.rank === begin.length,
      `Error in slice${input.rank}D: Length of begin ${begin} must ` +
          `match the rank of the array (${input.rank}).`);
  util.assert(
      input.rank === size.length,
      `Error in slice${input.rank}D: Length of size ${size} must ` +
          `match the rank of the array (${input.rank}).`);

  for (let i = 0; i < input.rank; ++i) {
    util.assert(
        begin[i] + size[i] <= input.shape[i],
        `Error in slice${input.rank}D: begin[${i}] + size[${i}] ` +
            `(${begin[i] + size[i]}) would overflow input.shape[${i}] (${
                input.shape[i]})`);
  }
}

/**
 * Calculate the start index and output tensor shape for strided slice op.
 * @returns array of [startIndex, size, shrinkAxis]
 */
export function getStridedSlicedInfo(
    shape: number[], begin: number[], end: number[], strides: number[],
    beginMask = 0, endMask = 0, ellipsisMask = 0, newAxisMask = 0,
    shrinkAxisMask = 0): [number[], number[], number[]] {
  if (ellipsisMask !== 0) {
    throw new Error('ellipsis mask is not yet supported');
  }
  if (newAxisMask !== 0) {
    throw new Error('new axis mask is not yet supported');
  }
  // Note that the axis orders are reversed for runtime ops, so the indices,
  // strides and masks must be as well too.
  const startIndex: number[] = [];
  const endIndex: number[] = [];
  const shrinkAxis: number[] = [];
  for (let i = 0; i < shape.length; i++) {
    startIndex[i] = startForAxis(beginMask, begin, strides, shape, i);
    endIndex[i] = stopForAxis(endMask, end, strides, shape, i);
    // When shrinking an axis, use startIndex + 1 for endIndex.
    // Check the axis bit from right of shrinkAxisMask
    if (shrinkAxisMask & 1 << i) {
      endIndex[i] = startIndex[i] + 1;
      shrinkAxis.push(i);
    }
  }

  let size = new Array(shape.length).fill(0);
  size = size.map((d, i) => {
    let count = 0;
    for (let start = startIndex[i];
         !(strides[i] > 0 ? start >= endIndex[i] : start <= endIndex[i]);
         start += strides[i]) {
      count += 1;
    }
    return count;
  });

  return [startIndex, size, shrinkAxis];
}

export function startForAxis(
    beginMask: number, startIndices: number[], strides: number[],
    inputShape: number[], axis: number): number {
  // Begin with the specified index
  let start = startIndices[axis];

  // Check the axis bit from right of beginMask
  if (beginMask & 1 << axis) {
    if (strides[axis] > 0) {
      // Forward iteration - use the first element. These values will get
      // clamped below (Note: We could have set them to 0 and axis_size-1, but
      // use lowest() and max() to maintain symmetry with StopForAxis())
      start = Number.MIN_SAFE_INTEGER;
    } else {
      // Backward iteration - use the last element.
      start = Number.MAX_SAFE_INTEGER;
    }
  }

  // Handle negative indices
  const axisSize = inputShape[axis];
  if (start < 0) {
    start += axisSize;
  }

  // Clamping
  start = util.clamp(0, start, axisSize - 1);

  return start;
}

export function stopForAxis(
    endMask: number, stopIndices: number[], strides: number[],
    inputShape: number[], axis: number): number {
  // Begin with the specified index
  let stop = stopIndices[axis];

  // Check the axis bit from right of endMask
  if (endMask & (1 << axis)) {
    if (strides[axis] > 0) {
      // Forward iteration - use the last element. These values will get
      // clamped below
      stop = Number.MAX_SAFE_INTEGER;
    } else {
      // Backward iteration - use the first element.
      stop = Number.MIN_SAFE_INTEGER;
    }
  }

  // Handle negative indices
  const axisSize = inputShape[axis];
  if (stop < 0) {
    stop += axisSize;
  }

  // Clamping
  // Because the end index points one past the last element, we need slightly
  // different clamping ranges depending on the direction.
  if (strides[axis] > 0) {
    // Forward iteration
    stop = util.clamp(0, stop, axisSize);
  } else {
    // Backward iteration
    stop = util.clamp(-1, stop, axisSize - 1);
  }

  return stop;
}

/**
 * Returns true if the slice occupies a continous set of elements in the
 * 'flat' space.
 */
export function isSliceContinous(
    shape: number[], begin: number[], size: number[]) {
  // Index of the first axis that has size > 1.
  let firstNonOneAxis = size.length;
  for (let i = 0; i < size.length; i++) {
    if (size[i] > 1) {
      firstNonOneAxis = i;
      break;
    }
  }

  for (let i = firstNonOneAxis + 1; i < size.length; i++) {
    if (begin[i] > 0 || size[i] !== shape[i]) {
      return false;
    }
  }
  return true;
}

export function computeFlatOffset(begin: number[], strides: number[]): number {
  let flatOffset = begin.length > 0 ? begin[begin.length - 1] : 1;
  for (let i = 0; i < begin.length - 1; i++) {
    flatOffset += begin[i] * strides[i];
  }
  return flatOffset;
}
