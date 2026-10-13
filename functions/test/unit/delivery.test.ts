import { describe, expect, it } from 'vitest';

import { porterStatus } from '../../src/delivery/couriers.js';
import { coordsFromText, istDate } from '../../src/delivery/model.js';

describe('map locations', () => {
  it('reads coordinates from typed pairs and Google Maps links', () => {
    expect(coordsFromText('12.9716, 77.5946')).toEqual({ lat: 12.9716, lng: 77.5946 });
    expect(coordsFromText('https://www.google.com/maps/place/Cubbon+Park/@12.9763,77.5929,17z/data=!3m1')).toEqual({ lat: 12.9763, lng: 77.5929 });
    expect(coordsFromText('https://www.google.com/maps/place/X/data=!4m6!3m5!1s0x0:0x0!8m2!3d12.97!4d77.59')).toEqual({ lat: 12.97, lng: 77.59 });
    expect(coordsFromText('https://maps.google.com/?q=12.97,77.59')).toEqual({ lat: 12.97, lng: 77.59 });
    expect(coordsFromText('https://www.google.com/maps/search/?api=1&query=12.9%2C77.5')).toEqual({ lat: 12.9, lng: 77.5 });
    expect(coordsFromText('12 MG Road, Bengaluru')).toBeNull();
    expect(coordsFromText('120, 77')).toBeNull();
  });

  it('works out India dates', () => {
    expect(istDate(0, new Date('2026-10-13T20:00:00Z'))).toBe('2026-10-14');
    expect(istDate(1, new Date('2026-10-13T10:00:00Z'))).toBe('2026-10-14');
  });
});

describe('Porter statuses', () => {
  it('maps order states and webhook events to ours', () => {
    expect(['open', 'order_reopened'].map(porterStatus)).toEqual(['BOOKED', 'BOOKED']);
    expect(['accepted', 'order_accepted'].map(porterStatus)).toEqual(['ASSIGNED', 'ASSIGNED']);
    expect(['live', 'in_progress', 'order_start_trip'].map(porterStatus)).toEqual(['IN_TRANSIT', 'IN_TRANSIT', 'IN_TRANSIT']);
    expect(['ended', 'order_end_job', 'Completed'].map(porterStatus)).toEqual(['DELIVERED', 'DELIVERED', 'DELIVERED']);
    expect(['cancelled', 'order_cancel'].map(porterStatus)).toEqual(['CANCELLED', 'CANCELLED']);
    expect(porterStatus('something_new')).toBe('UNKNOWN');
  });
});
