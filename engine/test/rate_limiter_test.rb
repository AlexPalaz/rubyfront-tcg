# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/rubyfront/rate_limiter"

# Il limitatore a finestra fissa (2026-10-21, audit RF-016, T18).
class RateLimiterTest < Minitest::Test
  def limiter(limit: 3, window_s: 60, max_keys: 10_000)
    @now = 1000.0
    [Rubyfront::RateLimiter.new(limit: limit, window_s: window_s, clock: -> { @now }, max_keys: max_keys)]
  end

  def test_allows_up_to_limit_then_refuses
    (rl,) = limiter
    3.times { assert rl.allow?("ip:1") }
    refute rl.allow?("ip:1")
    refute rl.allow?("ip:1"), "la raffica non conta"
  end

  def test_window_rolls_over_with_injected_clock
    (rl,) = limiter
    3.times { rl.allow?("ip:1") }
    @now += 59
    refute rl.allow?("ip:1")
    @now += 1
    assert rl.allow?("ip:1"), "la finestra è passata"
    2.times { assert rl.allow?("ip:1") }
    refute rl.allow?("ip:1")
  end

  def test_keys_are_independent
    (rl,) = limiter(limit: 1)
    assert rl.allow?("ip:1")
    assert rl.allow?("ip:2")
    assert rl.allow?("user:mario")
    refute rl.allow?("ip:1")
    refute rl.allow?("user:mario")
  end

  def test_retry_after
    (rl,) = limiter(limit: 2, window_s: 30)
    assert_equal 0.0, rl.retry_after("k")
    2.times { rl.allow?("k") }
    assert_in_delta 30.0, rl.retry_after("k"), 0.001
    @now += 12
    assert_in_delta 18.0, rl.retry_after("k"), 0.001
    @now += 20
    assert_equal 0.0, rl.retry_after("k")
  end

  def test_sweep_drops_expired_and_caps_keys
    (rl,) = limiter(limit: 1, window_s: 10, max_keys: 3)
    rl.allow?("a")
    rl.allow?("b")
    assert_equal 2, rl.size
    @now += 11
    rl.sweep
    assert_equal 0, rl.size
    rl.allow?("c")
    rl.allow?("d")
    rl.allow?("e")
    @now += 11
    assert rl.allow?("f"), "al tetto delle chiavi si spazza prima di contare"
    assert_equal 1, rl.size
  end

  def test_is_thread_safe_under_a_burst
    (rl,) = limiter(limit: 50, window_s: 60)
    passed = Queue.new
    threads = 8.times.map { Thread.new { 20.times { passed << 1 if rl.allow?("k") } } }
    threads.each(&:join)
    assert_equal 50, passed.size
  end
end
