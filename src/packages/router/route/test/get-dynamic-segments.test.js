// @flow


import getDynamicSegments from '../utils/get-dynamic-segments';

describe('module "router/route"', () => {
  describe('util getDynamicSegments()', () => {
    it('parses the dynamic segments in a path', () => {
      const segments = getDynamicSegments('/posts/:pid/comments/:cid');
      expect(segments).toEqual(['pid', 'cid']);
    });

    it('does not parse static segments in a path', () => {
      const segments = getDynamicSegments('/posts');
      expect(segments).to.be.empty;
    });

    it('handles paths containing a trailing forward-slash', () => {
      const path = '/posts/:pid/comments/:cid';
      const segments = getDynamicSegments(path);
      const segmentsWithTrailingSlash = getDynamicSegments(path + '/');
      expect(segments).toEqual(segmentsWithTrailingSlash);
    });
  });
});
