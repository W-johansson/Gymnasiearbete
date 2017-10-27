% calcAngle.m - Calculate angles of a bus from GPS data
% By Axel F

% Derivate the velocity to get the acceleration
a = diff(v) ./ diff(t);
% Integrate the velocity to get the distance
s = cumtrapz(t, v);

l = 6; % The length of the bus in metres

% Plot some graphs
subplot(2, 1, 1);
plot(t, s);
xlabel('Time (s)');
ylabel('Distance (m)');
subplot(2, 1, 2);
plot(t, h);
xlabel('Time (s)');
ylabel('Height (m)');

% Calculate the first 50 angles
angles = zeros(size(t));
for i = 1:50
  s1 = s(i);
  h1 = h(i);

  % Magic
  x = fminbnd(@(x) (l^2 - (x^2 + (interp1(s, h, s1 + x) - h1)^2))^2, 0, l);
  h2 = interp1(s, h, s1 + x);

  %{
  %              _-´|
  %           _-´   |
  %        _-´      | Opposite = h2 - h1
  %     _-´         |
  %  _-´ ) v        |
  % -----------------
  %   Adjacent = x
  %
  % tan v = opposite / adjacent
  %}
  angles(i) = atand((h2 - h1) / x);

  fprintf('Angle #%d is %f degrees. (x: %d, h1: %d, h2: %d)\n', i, angles(i), x, h1, h2);
end

